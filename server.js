// ============================================================
// 篮球人生 (Basketball Life) — 独立 Web 版服务器
// Express: 静态托管 + LLM 代理 (_ll / _ls) + 存档 + 快照 + 提示词 + 世界书
// ============================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '4mb' }));

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const WORLDBOOK_DIR = path.join(ROOT, 'worldbook');

for (const dir of [DATA_DIR, SNAP_DIR, WORLDBOOK_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// 配置
// ============================================================

const CONFIG_FILE = path.join(ROOT, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return { api_key: '', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' };
  }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

app.get('/api/config', (req, res) => {
  const cfg = loadConfig();
  res.json({
    success: true,
    config: {
      base_url: cfg.base_url,
      model: cfg.model,
      api_key_masked: maskApiKey(cfg.api_key),
      has_api_key: Boolean(cfg.api_key)
    }
  });
});

app.post('/api/config', (req, res) => {
  const cfg = loadConfig();
  const { base_url, model, api_key } = req.body || {};
  if (typeof base_url === 'string' && base_url.trim()) cfg.base_url = base_url.trim();
  if (typeof model === 'string' && model.trim()) cfg.model = model.trim();
  if (typeof api_key === 'string') {
    const v = api_key.trim();
    // 掩码回传（前端未修改直接保存）忽略；空字符串清除；其他值设置
    if (!v.includes('****')) cfg.api_key = v;
  }
  try {
    saveConfig(cfg);
    res.json({ success: true, config: { base_url: cfg.base_url, model: cfg.model, api_key_masked: maskApiKey(cfg.api_key), has_api_key: Boolean(cfg.api_key) } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============================================================
// LLM 调用 (OpenAI 兼容)
// ============================================================

// _ll — 非流式调用（开局生成）
async function _ll(prompt, systemPrompt, temperature) {
  const cfg = loadConfig();
  if (!cfg.api_key || !cfg.base_url) throw new Error('LLM 未配置：请在设置中填写 api_key / base_url');

  const url = cfg.base_url.replace(/\/+$/, '') + '/chat/completions';
  const resp = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(120000), // 防止上游挂起永久阻塞
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.api_key}`
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: false,
      temperature: temperature ?? cfg.temperature ?? 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM 返回为空');
  return content;
}

// _ls — 流式调用（SSE）。async generator，逐段 yield 文本增量。
// externalSignal：调用方（HTTP 路由）传入的取消信号，客户端断开时中止上游请求
async function* _ls(prompt, systemPrompt, temperature, externalSignal) {
  const cfg = loadConfig();
  if (!cfg.api_key || !cfg.base_url) throw new Error('LLM 未配置：请在设置中填写 api_key / base_url');

  const url = cfg.base_url.replace(/\/+$/, '') + '/chat/completions';
  const timeoutSignal = AbortSignal.timeout(180000); // 流式整体超时，防止连接半开挂起
  const resp = await fetch(url, {
    method: 'POST',
    signal: externalSignal ? AbortSignal.any([timeoutSignal, externalSignal]) : timeoutSignal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.api_key}`
    },
    body: JSON.stringify({
      model: cfg.model,
      stream: true,
      temperature: temperature ?? cfg.temperature ?? 0.8,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';

  // 解析上游 OpenAI SSE 格式：行以 "data: " 开头
  let upstreamDone = false;
  const parseBuf = function* () {
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { upstreamDone = true; return; }
      try {
        const json = JSON.parse(payload);
        const delta = json?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* 跳过不完整的行 */ }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    yield* parseBuf();
    if (upstreamDone) {
      try { await reader.cancel(); } catch { /* 已关闭 */ }
      return;
    }
  }
  // 尾部 flush：处理不带换行的最后一个 data 行与跨块多字节字符
  buf += decoder.decode();
  yield* parseBuf();
}

app.post('/api/llm/non-stream', async (req, res) => {
  const { prompt, system_prompt, temperature } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'Missing prompt' });
  try {
    const content = await _ll(prompt, system_prompt, temperature);
    res.json({ success: true, content });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取上游模型列表（GET {base_url}/models 代理）
app.get('/api/llm/models', async (req, res) => {
  const cfg = loadConfig();
  if (!cfg.api_key || !cfg.base_url) {
    return res.status(400).json({ success: false, error: 'LLM 未配置：请先填写 api_key / base_url' });
  }
  try {
    const url = cfg.base_url.replace(/\/+$/, '') + '/models';
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Authorization': `Bearer ${cfg.api_key}` }
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    const models = (data?.data || [])
      .map(m => m.id)
      .filter(Boolean)
      .sort();
    res.json({ success: true, models });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/llm/stream', async (req, res) => {  const { prompt, system_prompt, temperature } = req.body || {};
  if (!prompt) return res.status(400).json({ success: false, error: 'Missing prompt' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  // 客户端断开（页面关闭/重生成/读档）时中止上游 LLM 流，避免白耗 token。
  // 注意：req 的 'close' 在请求体消费完就会触发，不能用它判断客户端断开；
  // 用 res 的 'close' + writableEnded 区分"正常结束"与"连接中断"。
  const clientAbort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) clientAbort.abort();
  });

  try {
    for await (const chunk of _ls(prompt, system_prompt, temperature, clientAbort.signal)) {
      if (res.writableEnded) break;
      send({ type: 'delta', content: chunk });
    }
    if (!res.writableEnded) send({ type: 'done' });
  } catch (e) {
    if (!res.writableEnded) send({ type: 'error', error: e.message });
  }
  res.end();
});

// ============================================================
// 提示词（默认模板 + 用户自定义）
// ============================================================

const PROMPTS_FILE = path.join(ROOT, 'prompts.json');

// 默认提示词单一事实源：prompts-default.json（APK 原生模式共用同一份，经 tools/sync-native.js 复制进 public/）
const DEFAULTS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'prompts-default.json'), 'utf-8'));
  } catch (e) {
    console.error('[prompts] prompts-default.json 缺失或损坏，使用内置兜底:', e.message);
    return { system_prompt: '你是一个沉浸式篮球人生模拟游戏引擎。', game_intro: '', game_action: '' };
  }
})();
const DEFAULT_SYSTEM_PROMPT = DEFAULTS.system_prompt;

function loadCustomPrompts() {
  try {
    return JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf-8'));
  } catch {
    return { system_prompt: '', unrestricted_prompt: '' };
  }
}

function saveCustomPrompts(p) {
  fs.writeFileSync(PROMPTS_FILE, JSON.stringify(p, null, 2), 'utf-8');
}

// 组装最终 system prompt：基础(可被用户覆盖) + 无限制提示词(用户自填，默认空)
function buildSystemPrompt() {
  const custom = loadCustomPrompts();
  const base = (custom.system_prompt && custom.system_prompt.trim())
    ? custom.system_prompt
    : DEFAULT_SYSTEM_PROMPT;
  let sys = base;
  if (custom.unrestricted_prompt && custom.unrestricted_prompt.trim()) {
    sys += '\n\n' + custom.unrestricted_prompt.trim();
  }
  return sys;
}

app.get('/api/prompts/default', (req, res) => {
  res.json({
    success: true,
    prompts: {
      system_prompt: DEFAULT_SYSTEM_PROMPT,
      game_intro: DEFAULTS.game_intro,
      game_action: DEFAULTS.game_action
    }
  });
});

app.get('/api/prompts/custom', (req, res) => {
  res.json({ success: true, prompts: loadCustomPrompts() });
});

app.post('/api/prompts/custom', (req, res) => {
  const { system_prompt, unrestricted_prompt } = req.body || {};
  const p = loadCustomPrompts();
  if (typeof system_prompt === 'string') p.system_prompt = system_prompt;
  if (typeof unrestricted_prompt === 'string') p.unrestricted_prompt = unrestricted_prompt;
  try {
    saveCustomPrompts(p);
    res.json({ success: true, prompts: p });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 前端获取最终组装的 system prompt（含世界书由前端拼接，这里只给基础+无限制部分）
app.get('/api/prompts/system', (req, res) => {
  res.json({ success: true, system_prompt: buildSystemPrompt() });
});

// ============================================================
// 世界书
// ============================================================

function readWorldbook() {
  const files = fs.readdirSync(WORLDBOOK_DIR).filter(f => f.endsWith('.json'));
  const books = {};
  for (const f of files) {
    try {
      books[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(WORLDBOOK_DIR, f), 'utf-8'));
    } catch (e) {
      console.warn(`[worldbook] 解析失败 ${f}: ${e.message}`);
    }
  }
  return books;
}

app.get('/api/worldbook', (req, res) => {
  res.json({ success: true, worldbook: readWorldbook() });
});

// body: { name: "cba", content: {...} }
app.post('/api/worldbook', (req, res) => {
  const { name, content } = req.body || {};
  if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
    return res.status(400).json({ success: false, error: '非法的世界书名称' });
  }
  if (typeof content !== 'object' || content === null) {
    return res.status(400).json({ success: false, error: 'content 必须是对象' });
  }
  try {
    fs.writeFileSync(path.join(WORLDBOOK_DIR, `${name}.json`), JSON.stringify(content, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/worldbook/delete', (req, res) => {
  const { name } = req.body || {};
  if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
    return res.status(400).json({ success: false, error: '非法的世界书名称' });
  }
  const file = path.join(WORLDBOOK_DIR, `${name}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

// ============================================================
// 存档
// ============================================================

app.post('/api/save', (req, res) => {
  const { slot, data } = req.body || {};
  if (!slot || !/^[a-zA-Z0-9_\-]+$/.test(slot)) {
    return res.status(400).json({ success: false, error: '非法存档槽名' });
  }
  const saveData = {
    meta: { slot, saved_at: new Date().toISOString(), version: '1.0.0' },
    game_state: data
  };
  fs.writeFileSync(path.join(DATA_DIR, `save_${slot}.json`), JSON.stringify(saveData, null, 2), 'utf-8');
  res.json({ success: true, saved_at: saveData.meta.saved_at });
});

app.get('/api/load/:slot', (req, res) => {
  if (!/^[a-zA-Z0-9_\-]+$/.test(req.params.slot)) {
    return res.status(400).json({ success: false, error: '非法存档槽名' });
  }
  const file = path.join(DATA_DIR, `save_${req.params.slot}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: '存档不存在' });
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
  } catch (e) {
    res.status(500).json({ success: false, error: '存档损坏：' + e.message });
  }
});

app.get('/api/saves', (req, res) => {
  const saves = [];
  for (const f of fs.readdirSync(DATA_DIR)) {
    const m = f.match(/^save_(.+)\.json$/);
    if (!m) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf-8'));
      saves.push({
        slot: m[1],
        saved_at: data.meta?.saved_at || 'unknown',
        player_name: data.game_state?.player?.name || '未知球员',
        story_stage: data.game_state?.story_stage || '',
        team: data.game_state?.season?.team || ''
      });
    } catch { /* 跳过损坏存档 */ }
  }
  saves.sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
  res.json({ success: true, saves });
});

app.post('/api/save/delete', (req, res) => {
  const { slot } = req.body || {};
  if (!slot || !/^[a-zA-Z0-9_\-]+$/.test(slot)) {
    return res.status(400).json({ success: false, error: '非法存档槽名' });
  }
  const file = path.join(DATA_DIR, `save_${slot}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  res.json({ success: true });
});

// ============================================================
// 快照 (ts / rs)
// ============================================================

app.post('/api/snapshot', (req, res) => {
  const { data, label } = req.body || {};
  if (!data) return res.status(400).json({ success: false, error: 'Missing data' });
  const id = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const snap = { id, label: label || '', created_at: new Date().toISOString(), data };
  fs.writeFileSync(path.join(SNAP_DIR, `${id}.json`), JSON.stringify(snap, null, 2), 'utf-8');
  // 只保留最近 50 个快照
  const snaps = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json')).sort();
  while (snaps.length > 50) {
    fs.rmSync(path.join(SNAP_DIR, snaps.shift()), { force: true });
  }
  res.json({ success: true, id, created_at: snap.created_at });
});

app.post('/api/snapshot/restore', (req, res) => {
  const { id } = req.body || {};
  if (!id || !/^[a-zA-Z0-9_\-]+$/.test(id)) {
    return res.status(400).json({ success: false, error: '非法快照 id' });
  }
  const file = path.join(SNAP_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: '快照不存在' });
  try {
    const snap = JSON.parse(fs.readFileSync(file, 'utf-8'));
    res.json({ success: true, ...snap });
  } catch (e) {
    res.status(500).json({ success: false, error: '快照损坏：' + e.message });
  }
});

app.get('/api/snapshots', (req, res) => {
  const snaps = [];
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf-8'));
      snaps.push({ id: s.id, label: s.label, created_at: s.created_at });
    } catch { /* skip */ }
  }
  snaps.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  res.json({ success: true, snapshots: snaps.slice(0, 20) });
});

// ============================================================
// 静态资源
// ============================================================

app.use(express.static(path.join(ROOT, 'public')));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  res.sendFile(path.join(ROOT, 'public', 'index.html'));
});

// ============================================================
// 启动
// ============================================================

const PORT = loadConfig().server?.port || 3000;
// 默认只绑本机回环；如需局域网访问，在 config.json 显式设置 server.host
const HOST = loadConfig().server?.host || '127.0.0.1';

app.listen(PORT, HOST, () => {
  const cfg = loadConfig();
  console.log('');
  console.log('============================================');
  console.log('  篮球人生 (Basketball Life)');
  console.log('  LLM 驱动的文字篮球人生模拟游戏');
  console.log('============================================');
  console.log(`  地址:     http://localhost:${PORT}`);
  console.log(`  LLM:      ${cfg.model || '未配置'} @ ${cfg.base_url || '未配置'}`);
  console.log(`  API Key:  ${cfg.api_key ? '已配置' : '未配置（将使用试玩模式）'}`);
  console.log('============================================');
  console.log('');
});
