// ============================================================
// 篮球人生 — API 黑盒边界测试
// 前提: mock LLM (3001) 与游戏服务器 (3000) 均已启动
// 用法: node test/api-tests.js
// 注意: 会临时修改 config.json 的 api_key，结束时恢复为 mock key
// ============================================================

const BASE = 'http://localhost:3000';
const MOCK_KEY = 'sk-mock-test-key';

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch(e => { failed++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name}\n      ${e.message}`); });
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || '不等'}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}

const post = (url, body) => fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const get = (url) => fetch(BASE + url);

async function main() {
  // 记录原始 config，结束时恢复；清理测试灌入的快照
  const fs = require('fs');
  const path = require('path');
  const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
  const SNAP_DIR = path.join(__dirname, '..', 'data', 'snapshots');
  const origConfig = fs.readFileSync(CONFIG_PATH, 'utf8');
  const cleanup = () => {
    try {
      fs.writeFileSync(CONFIG_PATH, origConfig);
      for (const f of fs.readdirSync(SNAP_DIR)) {
        if (f.endsWith('.json')) fs.rmSync(path.join(SNAP_DIR, f), { force: true });
      }
    } catch { /* 尽力恢复 */ }
  };

  console.log('\n== 输入校验与路径安全 ==');

  await test('存档槽名路径穿越被拒', async () => {
    const r = await post('/api/save', { slot: '../evil', data: {} });
    assertEq(r.status, 400);
  });

  await test('存档槽名特殊字符被拒', async () => {
    const r = await post('/api/save', { slot: 'a;b', data: {} });
    assertEq(r.status, 400);
  });

  await test('读档路径穿越被拒（槽名白名单）', async () => {
    const r = await get('/api/load/..%2Fconfig');
    assertEq(r.status, 400);
    // 审查发现的 PoC：曾可读到 config.json 明文（api_key），修复后必须 400
    const poc = await get('/api/load/a%2F..%2F..%2Fconfig');
    assertEq(poc.status, 400, 'PoC 穿越 payload 必须 400');
  });

  await test('快照恢复非法 id 被拒', async () => {
    const r = await post('/api/snapshot/restore', { id: '../../config' });
    assertEq(r.status, 400);
  });

  await test('快照恢复不存在的 id → 404', async () => {
    const r = await post('/api/snapshot/restore', { id: 'nonexistent_abc' });
    assertEq(r.status, 404);
  });

  await test('世界书恶意文件名被拒', async () => {
    const r = await post('/api/worldbook', { name: '../x', content: {} });
    assertEq(r.status, 400);
  });

  await test('世界书 content 非对象被拒', async () => {
    const r = await post('/api/worldbook', { name: 'okname', content: 'not-object' });
    assertEq(r.status, 400);
  });

  await test('LLM 调用缺 prompt → 400', async () => {
    const r = await post('/api/llm/non-stream', {});
    assertEq(r.status, 400);
    const r2 = await post('/api/llm/stream', { system_prompt: 'x' });
    assertEq(r2.status, 400);
  });

  await test('非法 JSON body → 400', async () => {
    const r = await fetch(BASE + '/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
    assertEq(r.status, 400);
  });

  console.log('\n== 存档流程 ==');

  await test('保存→读取→列表→删除 round-trip', async () => {
    const data = { player: { name: '边界测试员' }, story_stage: 'cba', season: { team: '上海久事大鲨鱼' } };
    const saveR = (await (await post('/api/save', { slot: 'edge1', data })).json());
    assert(saveR.success, '保存失败');

    const loadR = await (await get('/api/load/edge1')).json();
    assertEq(loadR.game_state.player.name, '边界测试员');

    const listR = await (await get('/api/saves')).json();
    const found = listR.saves.find(s => s.slot === 'edge1');
    assert(found && found.player_name === '边界测试员' && found.team === '上海久事大鲨鱼', '列表信息不全');

    await post('/api/save/delete', { slot: 'edge1' });
    const after = await get('/api/load/edge1');
    assertEq(after.status, 404, '删除后应 404');
  });

  await test('读取不存在的存档 → 404', async () => {
    assertEq((await get('/api/load/nope')).status, 404);
  });

  console.log('\n== 快照裁剪 ==');

  await test('快照保留上限 50 个', async () => {
    for (let i = 0; i < 55; i++) {
      await post('/api/snapshot', { data: { i }, label: 'bulk' + i });
    }
    const fs = require('fs');
    const files = fs.readdirSync(require('path').join(__dirname, '..', 'data', 'snapshots')).filter(f => f.endsWith('.json'));
    assertEq(files.length, 50, `写入 55 个后应恰好保留 50，实际 ${files.length}`);
    const listR = await (await get('/api/snapshots')).json();
    assertEq(listR.snapshots.length, 20, '列表应只回最近 20 个');
    // 恢复有效 id：响应必须含 success 与 data（前端契约）
    const snapId = listR.snapshots[0].id;
    const restoreR = await (await post('/api/snapshot/restore', { id: snapId })).json();
    assert(restoreR.success === true && restoreR.data, '恢复响应缺 success/data');
  });

  console.log('\n== 配置与掩码保护 ==');

  await test('设置 key → 回传掩码不应清掉真实 key', async () => {
    // 设为 mock key
    await post('/api/config', { api_key: MOCK_KEY, base_url: 'http://localhost:3001/v1', model: 'mock-model' });
    const c1 = await (await get('/api/config')).json();
    assert(c1.config.has_api_key && c1.config.api_key_masked.includes('****'), '掩码形态不符');

    // 把掩码原样回传（模拟前端未修改直接保存）
    await post('/api/config', { api_key: c1.config.api_key_masked });
    const c2 = await (await get('/api/config')).json();
    assert(c2.config.has_api_key, '掩码回传不应清掉 key');

    // key 仍有效：LLM 调用应成功
    const llm = await post('/api/llm/non-stream', { prompt: '生成开局场景\n球员姓名：掩码测试\n位置：SF\n身高：188\n体重：80\n起始舞台：high_school' });
    const llmJ = await llm.json();
    assert(llmJ.success && llmJ.content.includes('##STATE##'), 'key 应仍有效');
  });

  await test('空字符串 key 清除配置', async () => {
    await post('/api/config', { api_key: '' });
    const c = await (await get('/api/config')).json();
    assert(!c.config.has_api_key, 'key 应被清除');
    // 恢复 mock key 供后续测试
    await post('/api/config', { api_key: MOCK_KEY });
  });

  await test('部分更新（只改 model 不动 key）', async () => {
    await post('/api/config', { model: 'mock-model-2' });
    const c = await (await get('/api/config')).json();
    assertEq(c.config.model, 'mock-model-2');
    assert(c.config.has_api_key, 'key 不应被波及');
    await post('/api/config', { model: 'mock-model' });
  });

  console.log('\n== LLM 错误传播 ==');

  await test('模型列表：未配置 key 时 400', async () => {
    await post('/api/config', { api_key: '' });
    const r = await get('/api/llm/models');
    assertEq(r.status, 400);
    await post('/api/config', { api_key: MOCK_KEY });
  });

  await test('模型列表：正常返回并排序', async () => {
    const r = await get('/api/llm/models');
    const j = await r.json();
    assert(j.success && j.models.includes('mock-model') && j.models.includes('mock-model-pro'), '应含 mock 模型: ' + JSON.stringify(j));
    assertEq(j.models, [...j.models].sort(), '应排序');
  });

  await test('模型列表：错误 key 透传', async () => {
    await post('/api/config', { api_key: 'invalid-key' });
    const r = await get('/api/llm/models');
    const j = await r.json();
    assert(!j.success && /401/.test(j.error), '应含 401: ' + j.error);
    await post('/api/config', { api_key: MOCK_KEY });
  });

  await test('上游 401 透传为错误', async () => {
    await post('/api/config', { api_key: 'invalid-key' });
    const r = await post('/api/llm/non-stream', { prompt: 'hi' });
    const j = await r.json();
    assert(!j.success && /401/.test(j.error), '应包含 401 信息: ' + j.error);
    await post('/api/config', { api_key: MOCK_KEY });
  });

  await test('上游不可达时报连接错误', async () => {
    await post('/api/config', { api_key: MOCK_KEY, base_url: 'http://localhost:9/v1' });
    const r = await post('/api/llm/non-stream', { prompt: 'hi' });
    const j = await r.json();
    assert(!j.success, '应失败');
    await post('/api/config', { base_url: 'http://localhost:3001/v1' });
  });

  console.log('\n== SSE 流式端到端 ==');

  await test('流式返回 delta 拼接完整且含协议标记与 done 事件', async () => {
    const resp = await fetch(BASE + '/api/llm/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: '当前状态：\n##STATE##\n{"player":{"name":"流测"},"energy":95}\n##ENDSTATE##\n球员选择了：测试行动',
        system_prompt: 'sys'
      })
    });
    assert(resp.headers.get('content-type').includes('text/event-stream'), 'Content-Type 应为 SSE');

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '', events = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const msg = JSON.parse(line.slice(6));
          events.push(msg.type);
          if (msg.type === 'delta') full += msg.content;
        }
      }
    }
    assert(full.includes('##STATE##') && full.includes('---CHOICES---'), '拼接内容缺协议标记');
    assert(full.includes('测试行动'), '叙事未包含行动文本');
    assert(events[events.length - 1] === 'done', '最后事件应为 done');
    assert(events.filter(t => t === 'delta').length > 5, 'delta 应分片多次推送');
  });

  console.log('\n== 提示词接口 ==');

  await test('custom 提示词写读一致', async () => {
    await post('/api/prompts/custom', { system_prompt: '测试基础提示词', unrestricted_prompt: '测试追加' });
    const p = await (await get('/api/prompts/custom')).json();
    assertEq(p.prompts.system_prompt, '测试基础提示词');
    assertEq(p.prompts.unrestricted_prompt, '测试追加');
    const sys = await (await get('/api/prompts/system')).json();
    assert(sys.system_prompt.includes('测试基础提示词') && sys.system_prompt.includes('测试追加'), '组装顺序不符');
    // 还原
    await post('/api/prompts/custom', { system_prompt: '', unrestricted_prompt: '' });
    const sys2 = await (await get('/api/prompts/system')).json();
    assert(sys2.system_prompt.includes('篮球人生模拟游戏引擎'), '空自定义应回退默认');
  });

  console.log('\n============================================');
  console.log(`  合计: ${passed} 通过 / ${failed} 失败`);
  console.log('============================================\n');
  cleanup();
  process.exit(failed > 0 ? 1 : 0);
}

main();
