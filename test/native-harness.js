// ============================================================
// native.js 纯 Node 验证 — 模拟 APK 环境跑全部本地 API 路径
// 前提: cap-sim-server(3300) 与 mock-llm(3001) 已启动
// 用法: node test/native-harness.js
// ============================================================
global.window = global; // native.js 挂 window.BBL / 检测 window.Capacitor

// localStorage 最小实现
const store = new Map();
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  get length() { return store.size; },
  key: i => Array.from(store.keys())[i] ?? null
};

// Capacitor 模拟（与 test/cap-mock.js 同构：CapacitorHttp → sim /llm-proxy）
global.Capacitor = {
  isNativePlatform: () => true,
  Plugins: {
    CapacitorHttp: {
      post(o) {
        return fetch('http://127.0.0.1:3300/llm-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: o.url, headers: o.headers, data: o.data })
        }).then(async r => {
          const j = await r.json();
          if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
          return j;
        });
      }
    }
  }
};

// 让 native.js 的 realFetch 指向模拟服务器（相对/根相对地址补基址；绝对地址直通）
const realFetch = global.fetch;
global.fetch = (u, o) => {
  if (typeof u === 'string' && !/^https?:\/\//.test(u)) {
    return realFetch('http://127.0.0.1:3300' + (u.startsWith('/') ? u : '/' + u), o);
  }
  return realFetch(u, o);
};

// 加载被测代码
const fs = require('fs');
const path = require('path');
eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'native.js'), 'utf8'));

let passed = 0, failed = 0;
const ok = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
};
const J = (o) => JSON.stringify(o);

(async () => {
  console.log('\n== ① 原生层激活与配置持久化 ==');
  ok('NATIVE 标志', BBL.NATIVE === true);
  let r = await fetch('/api/config');
  let j = await r.json();
  ok('初始无 key', j.success && j.config.has_api_key === false, J(j));

  r = await fetch('/api/config', { method: 'POST', body: J({ base_url: 'http://127.0.0.1:3001/v1', model: 'mock-model', api_key: 'sk-mock-test-key' }) });
  j = await r.json();
  ok('保存配置', j.success && j.config.has_api_key === true && /sk-m/.test(j.config.api_key_masked), J(j));

  r = await fetch('/api/config', { method: 'POST', body: J({ api_key: j.config.api_key_masked }) });
  j = await r.json();
  ok('掩码回传不清 key', j.config.has_api_key === true, J(j));

  console.log('\n== ② 打包资产读取 ==');
  r = await fetch('/api/prompts/default');
  j = await r.json();
  ok('默认提示词来自打包资产', j.prompts.system_prompt.includes('篮球人生模拟游戏引擎') && j.prompts.game_intro.includes('{worldbook}'));
  r = await fetch('/api/worldbook');
  j = await r.json();
  ok('世界书来自打包资产', j.worldbook.cba && j.worldbook.cba.teams.length === 20 && j.worldbook.nba.teams.length === 30);
  r = await fetch('/api/prompts/system');
  j = await r.json();
  ok('system 组装', j.system_prompt.includes('篮球人生模拟游戏引擎'));

  console.log('\n== ③ LLM 非流式（CapacitorHttp 路径） ==');
  r = await fetch('/api/llm/non-stream', { method: 'POST', body: J({ prompt: '生成开局场景\n球员姓名：验证员\n位置：PG\n身高：180\n体重：75\n起始舞台：high_school', system_prompt: 's' }) });
  j = await r.json();
  ok('开局生成', j.success && j.content.includes('##STATE##') && j.content.includes('验证员'), J(j).slice(0, 120));

  console.log('\n== ④ LLM 流式（模拟 SSE） ==');
  r = await fetch('/api/llm/stream', { method: 'POST', body: J({ prompt: '当前状态：\n##STATE##\n{"player":{"name":"流"},"energy":95}\n##ENDSTATE##\n球员选择了：加练投篮', system_prompt: 's' }) });
  ok('SSE Content-Type', (r.headers.get('content-type') || '').includes('text/event-stream'));
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '', events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx = i); buf = buf.slice(i + 2);
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const m = JSON.parse(line.slice(6));
        events.push(m.type);
        if (m.type === 'delta') full += m.content;
      }
    }
  }
  ok('流式含协议标记', full.includes('##STATE##') && full.includes('---CHOICES---'));
  ok('分片推送 + done 结尾', events.filter(t => t === 'delta').length > 5 && events[events.length - 1] === 'done');

  console.log('\n== ⑤ 前端解析管线消费 native 输出 ==');
  global.window = global;
  eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'state.js'), 'utf8'));
  const st = BBL.extractState(full);
  const merged = BBL.mergeState(BBL.getDefaultState(), st || {});
  ok('STATE 解析+合并', st && st.player && typeof merged.player.height === 'number');
  ok('选项提取', BBL.extractChoices(full).length >= 3);

  console.log('\n== ⑥ 存档与快照（localStorage） ==');
  const gs = BBL.getDefaultState(); gs.player.name = '验证员';
  r = await fetch('/api/save', { method: 'POST', body: J({ slot: 'slot1', data: gs }) });
  ok('保存 slot1', (await r.json()).success === true);
  r = await fetch('/api/load/slot1');
  j = await r.json();
  ok('读取 slot1', j.game_state && j.game_state.player.name === '验证员');
  r = await fetch('/api/load/..%2Fevil');
  ok('槽名白名单（拒访问即可）', r.status === 400 || r.status === 404, 'status=' + r.status);
  r = await fetch('/api/saves');
  j = await r.json();
  ok('存档列表', j.saves.some(s => s.slot === 'slot1' && s.player_name === '验证员'));

  let snapId;
  r = await fetch('/api/snapshot', { method: 'POST', body: J({ data: gs, label: '回合一' }) });
  j = await r.json(); snapId = j.id;
  ok('拍快照', j.success === true && !!snapId);
  r = await fetch('/api/snapshot/restore', { method: 'POST', body: J({ id: snapId }) });
  j = await r.json();
  ok('恢复快照（含 success/data）', j.success === true && j.data.player.name === '验证员');
  r = await fetch('/api/snapshots');
  j = await r.json();
  ok('快照列表', j.snapshots[0] && j.snapshots[0].id === snapId);

  console.log('\n============================================');
  console.log(`  合计: ${passed} 通过 / ${failed} 失败`);
  console.log('============================================\n');
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS_ERROR:', e); process.exit(1); });
