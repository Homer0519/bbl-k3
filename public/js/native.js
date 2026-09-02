// ============================================================
// 篮球人生 - APK 原生适配层 (Capacitor)
// 仅在 Capacitor 环境（window.Capacitor 存在，即打包成 APK 时）激活；
// Web 版（Express 服务器）完全不经过此文件逻辑。
//
// 原理：拦截 window.fetch，把所有 /api/* 请求在客户端本地实现——
//   存档/快照/配置/提示词 → localStorage
//   默认提示词/世界书     → 打包进 assets 的静态副本（tools/sync-native.js 同步）
//   LLM 调用             → CapacitorHttp 原生网络（绕过 WebView CORS 限制）
//   流式 SSE             → 上游按非流式取回全文后，本地模拟分片推送（保留打字机体验）
// ============================================================

window.BBL = window.BBL || {};
BBL.NATIVE = false;

(function () {
  'use strict';

  if (typeof window === 'undefined' || !window.Capacitor) return; // Web 版直通

  BBL.NATIVE = true;
  const realFetch = window.fetch.bind(window);
  const http = window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp
    ? window.Capacitor.Plugins.CapacitorHttp : null;

  // ---- 本地存储封装 ----
  const LS = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); }
  };

  function maskKey(key) {
    if (!key) return '';
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  }

  // 采样参数键（与 server.js SAMPLING_KEYS 一致）
  const SAMPLING_KEYS = ['temperature', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty', 'max_tokens'];

  // 组装 config 的公开视图（脱敏 key + 采样参数）
  function configView(cfg) {
    const sampling = {};
    for (const k of SAMPLING_KEYS) if (typeof cfg[k] === 'number') sampling[k] = cfg[k];
    return { base_url: cfg.base_url, model: cfg.model, api_type: cfg.api_type === 'responses' ? 'responses' : 'chat_completions', ...sampling, api_key_masked: maskKey(cfg.api_key), has_api_key: !!cfg.api_key };
  }

  // 酒馆预设拼接（与 server.js 同款逻辑）
  function convertTavernMacros(text) {
    return String(text)
      .replace(/\{\{user\}\}/gi, '玩家')
      .replace(/\{\{char\}\}/gi, '旁白')
      .replace(/\{\{\s*setvar::[^:]+::([\s\S]*?)\}\}/gi, '$1')
      .replace(/\{\{\s*getvar::[^}]*\}\}/gi, '')
      .replace(/\{\{\s*trim\s*\}\}/gi, '')
      .replace(/\{\{\s*\/\/[\s\S]*?\}\}/g, '');
  }

  function composeTavernSection(preset) {
    if (!preset || typeof preset !== 'object' || !Array.isArray(preset.prompts)) return '';
    const byId = {};
    for (const p of preset.prompts) if (p && p.identifier) byId[p.identifier] = p;
    const order = preset.prompt_order && preset.prompt_order[0] && Array.isArray(preset.prompt_order[0].order)
      ? preset.prompt_order[0].order : null;
    const parts = [];
    const seen = new Set();
    const push = (p) => {
      if (!p || p.marker || typeof p.content !== 'string') return;
      const c = p.content.trim();
      if (!c || seen.has(c)) return;
      seen.add(c);
      parts.push(convertTavernMacros(c));
    };
    if (order) {
      for (const o of order) { if (o && o.enabled !== false) push(byId[o.identifier]); }
    } else {
      for (const p of preset.prompts) { if (p.enabled !== false) push(p); }
    }
    return parts.join('\n\n');
  }

  function loadConfig() {
    return LS.get('bblv1_config', { api_key: '', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', temperature: 0.8 });
  }

  // ---- 打包资产（由 tools/sync-native.js 复制进 public/）----
  const assets = {
    prompts: null, // {system_prompt, game_intro, game_action}
    worldbook: null // {cba:{...}, nba:{...}}
  };
  async function loadDefaults() {
    if (!assets.prompts) {
      try { assets.prompts = await (await realFetch('prompts-default.json')).json(); }
      catch { assets.prompts = { system_prompt: '', game_intro: '', game_action: '' }; }
    }
    return assets.prompts;
  }
  async function loadWorldbookAssets() {
    if (!assets.worldbook) {
      assets.worldbook = {};
      for (const name of ['cba', 'nba']) {
        try { assets.worldbook[name] = await (await realFetch(`worldbook/${name}.json`)).json(); }
        catch { /* 缺失则跳过 */ }
      }
    }
    return assets.worldbook;
  }

  // ---- Response 构造 ----
  const jsonResponse = (obj, status) => new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });

  // ---- LLM（CapacitorHttp 原生请求，无 CORS 限制）----
  async function callLLM(prompt, systemPrompt) {
    if (!http) throw new Error('CapacitorHttp 不可用');
    const cfg = loadConfig();
    if (!cfg.api_key || !cfg.base_url) throw new Error('LLM 未配置：请在设置中填写 api_key / base_url');
    const base = String(cfg.base_url).replace(/\/+$/, '');
    const isResponses = cfg.api_type === 'responses';
    const url = base + (isResponses ? '/responses' : '/chat/completions');
    // 采样参数：仅发送显式设置的项
    const num = (v) => typeof v === 'number' && Number.isFinite(v);
    const sp = { temperature: cfg.temperature ?? 0.8 };
    if (num(cfg.top_p)) sp.top_p = cfg.top_p;
    if (num(cfg.max_tokens)) sp[isResponses ? 'max_output_tokens' : 'max_tokens'] = cfg.max_tokens;
    if (!isResponses) {
      if (num(cfg.top_k)) sp.top_k = cfg.top_k;
      if (num(cfg.presence_penalty)) sp.presence_penalty = cfg.presence_penalty;
      if (num(cfg.frequency_penalty)) sp.frequency_penalty = cfg.frequency_penalty;
    }
    const r = await http.post({
      url,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.api_key },
      data: isResponses ? {
        model: cfg.model,
        stream: false,
        ...sp,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]
      } : {
        model: cfg.model,
        stream: false,
        ...sp,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ]
      }
    });
    let content = '';
    if (isResponses) {
      content = typeof r.data?.output_text === 'string' && r.data.output_text ? r.data.output_text : '';
      if (!content && Array.isArray(r.data?.output)) {
        const parts = [];
        for (const item of r.data.output) {
          if (item?.type === 'message' && Array.isArray(item.content)) {
            for (const c of item.content) {
              if ((c?.type === 'output_text' || c?.type === 'text') && typeof c.text === 'string') parts.push(c.text);
            }
          }
        }
        content = parts.join('');
      }
    } else {
      content = r.data && r.data.choices && r.data.choices[0]
        && r.data.choices[0].message && r.data.choices[0].message.content;
    }
    if (!content) throw new Error('LLM 返回为空');
    return content;
  }

  // 获取上游模型列表（GET {base_url}/models）
  async function listModels() {
    if (!http) throw new Error('CapacitorHttp 不可用');
    const cfg = loadConfig();
    if (!cfg.api_key || !cfg.base_url) throw new Error('LLM 未配置：请先填写 api_key / base_url');
    const url = String(cfg.base_url).replace(/\/+$/, '') + '/models';
    const r = await http.get({ url, headers: { 'Authorization': 'Bearer ' + cfg.api_key } });
    const models = ((r.data && r.data.data) || []).map(m => m.id).filter(Boolean).sort();
    return models;
  }

  // ---- 模拟 SSE 流式响应（本地分片 + 延迟，走前端 _ls 解析器）----
  function sseResponse(fullText) {
    const enc = new TextEncoder();
    const CH = 18, DELAY = 24;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          for (let i = 0; i < fullText.length; i += CH) {
            send({ type: 'delta', content: fullText.slice(i, i + CH) });
            await new Promise(res => setTimeout(res, DELAY));
          }
          send({ type: 'done' });
        } catch (e) {
          send({ type: 'error', error: e.message });
        }
        controller.close();
      }
    });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  // ---- 快照存取（localStorage，上限 50）----
  function snapshots() { return LS.get('bblv1_snaps', []); }
  function saveSnapshots(list) { LS.set('bblv1_snaps', list.slice(-50)); }

  // ---- 请求体解析 ----
  async function readBody(opts) {
    if (opts && typeof opts.body === 'string') { try { return JSON.parse(opts.body); } catch { return {}; } }
    return {};
  }

  // ---- API 路由 ----
  async function handleApi(url, opts) {
    const method = (opts && opts.method) || 'GET';
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    const body = await readBody(opts);

    // ---------- 配置 ----------
    if (path === '/api/config' && method === 'GET') {
      const cfg = loadConfig();
      return jsonResponse({ success: true, config: configView(cfg) });
    }
    if (path === '/api/config' && method === 'POST') {
      const cfg = loadConfig();
      if (typeof body.base_url === 'string' && body.base_url.trim()) cfg.base_url = body.base_url.trim();
      if (typeof body.model === 'string' && body.model.trim()) cfg.model = body.model.trim();
      if (typeof body.api_key === 'string') {
        const v = body.api_key.trim();
        if (!v.includes('****')) cfg.api_key = v; // 掩码回传忽略
      }
      if (body.api_type === 'responses' || body.api_type === 'chat_completions') cfg.api_type = body.api_type;
      for (const k of SAMPLING_KEYS) {
        const v = body[k];
        if (typeof v === 'number' && Number.isFinite(v)) cfg[k] = v;
        else if (v === '' || v === null) delete cfg[k];
      }
      LS.set('bblv1_config', cfg);
      return jsonResponse({ success: true, config: configView(cfg) });
    }

    // ---------- API 配置方案 ----------
    const profileView = (p) => {
      const sampling = {};
      for (const k of SAMPLING_KEYS) if (typeof p[k] === 'number') sampling[k] = p[k];
      return { name: p.name, base_url: p.base_url, model: p.model, api_type: p.api_type === 'responses' ? 'responses' : 'chat_completions', ...sampling, api_key_masked: maskKey(p.api_key), has_api_key: !!p.api_key };
    };
    if (path === '/api/config/profiles' && method === 'GET') {
      const cfg = loadConfig();
      return jsonResponse({ success: true, profiles: (cfg.profiles || []).map(profileView) });
    }
    if (path === '/api/config/profiles/save' && method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name || name.length > 50) return jsonResponse({ success: false, error: '方案名无效（1-50 字符）' }, 400);
      const cfg = loadConfig();
      if (!Array.isArray(cfg.profiles)) cfg.profiles = [];
      const idx = cfg.profiles.findIndex(p => p.name === name);
      const p = { ...(idx >= 0 ? cfg.profiles[idx] : {}) };
      p.name = name;
      if (typeof body.base_url === 'string') p.base_url = body.base_url.trim();
      if (typeof body.model === 'string') p.model = body.model.trim();
      if (body.api_type === 'responses' || body.api_type === 'chat_completions') p.api_type = body.api_type;
      if (typeof body.api_key === 'string') { const v = body.api_key.trim(); if (!v.includes('****')) p.api_key = v; }
      for (const k of SAMPLING_KEYS) {
        const v = body[k];
        if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
        else if (v === '' || v === null) delete p[k];
      }
      cfg.profiles[idx >= 0 ? idx : cfg.profiles.length] = p;
      LS.set('bblv1_config', cfg);
      return jsonResponse({ success: true, profiles: cfg.profiles.map(profileView) });
    }
    if (path === '/api/config/profiles/delete' && method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const cfg = loadConfig();
      cfg.profiles = (cfg.profiles || []).filter(p => p.name !== name);
      LS.set('bblv1_config', cfg);
      return jsonResponse({ success: true, profiles: cfg.profiles.map(profileView) });
    }
    if (path === '/api/config/profiles/apply' && method === 'POST') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const cfg = loadConfig();
      const p = (cfg.profiles || []).find(p => p.name === name);
      if (!p) return jsonResponse({ success: false, error: '方案不存在：' + name }, 404);
      for (const k of ['base_url', 'model', 'api_type', 'api_key', ...SAMPLING_KEYS]) {
        if (p[k] === undefined) delete cfg[k]; else cfg[k] = p[k];
      }
      LS.set('bblv1_config', cfg);
      return jsonResponse({ success: true, config: configView(cfg) });
    }

    // ---------- 提示词 ----------
    if (path === '/api/prompts/default') {
      const d = await loadDefaults();
      return jsonResponse({ success: true, prompts: { system_prompt: d.system_prompt, game_intro: d.game_intro, game_action: d.game_action } });
    }
    if (path === '/api/prompts/custom' && method === 'GET') {
      return jsonResponse({ success: true, prompts: LS.get('bblv1_prompts', { system_prompt: '', unrestricted_prompt: '' }) });
    }
    if (path === '/api/prompts/custom' && method === 'POST') {
      const p = LS.get('bblv1_prompts', { system_prompt: '', unrestricted_prompt: '' });
      if (typeof body.system_prompt === 'string') p.system_prompt = body.system_prompt;
      if (typeof body.unrestricted_prompt === 'string') p.unrestricted_prompt = body.unrestricted_prompt;
      if (body.tavern_preset === null) delete p.tavern_preset;
      else if (body.tavern_preset && typeof body.tavern_preset === 'object' && !Array.isArray(body.tavern_preset)) {
        p.tavern_preset = body.tavern_preset;
      }
      LS.set('bblv1_prompts', p);
      return jsonResponse({ success: true, prompts: p });
    }
    if (path === '/api/prompts/system') {
      const d = await loadDefaults();
      const p = LS.get('bblv1_prompts', { system_prompt: '', unrestricted_prompt: '' });
      let sys = (p.system_prompt && p.system_prompt.trim()) ? p.system_prompt : d.system_prompt;
      const tavern = composeTavernSection(p.tavern_preset);
      if (tavern) sys += '\n\n' + tavern;
      if (p.unrestricted_prompt && p.unrestricted_prompt.trim()) sys += '\n\n' + p.unrestricted_prompt.trim();
      return jsonResponse({ success: true, system_prompt: sys });
    }

    // ---------- 世界书 ----------
    if (path === '/api/worldbook' && method === 'GET') {
      const base = await loadWorldbookAssets();
      const overrides = LS.get('bblv1_wb', {});
      return jsonResponse({ success: true, worldbook: Object.assign({}, base, overrides) });
    }
    if (path === '/api/worldbook' && method === 'POST') {
      if (!body.name || !/^[a-zA-Z0-9_\-]+$/.test(body.name) || typeof body.content !== 'object' || !body.content) {
        return jsonResponse({ success: false, error: '非法的世界书名称或内容' }, 400);
      }
      const ov = LS.get('bblv1_wb', {});
      ov[body.name] = body.content;
      LS.set('bblv1_wb', ov);
      return jsonResponse({ success: true });
    }
    if (path === '/api/worldbook/delete' && method === 'POST') {
      if (!body.name || !/^[a-zA-Z0-9_\-]+$/.test(body.name)) return jsonResponse({ success: false, error: '非法的世界书名称' }, 400);
      const ov = LS.get('bblv1_wb', {});
      delete ov[body.name];
      LS.set('bblv1_wb', ov);
      return jsonResponse({ success: true });
    }

    // ---------- 存档 ----------
    if (path === '/api/save' && method === 'POST') {
      if (!body.slot || !/^[a-zA-Z0-9_\-]+$/.test(body.slot)) return jsonResponse({ success: false, error: '非法存档槽名' }, 400);
      const saved = { meta: { slot: body.slot, saved_at: new Date().toISOString(), version: '1.0.0-native' }, game_state: body.data };
      LS.set('bblv1_save_' + body.slot, saved);
      return jsonResponse({ success: true, saved_at: saved.meta.saved_at });
    }
    const loadM = path.match(/^\/api\/load\/([a-zA-Z0-9_\-]+)$/);
    if (loadM) {
      const data = LS.get('bblv1_save_' + loadM[1], null);
      if (!data) return jsonResponse({ success: false, error: '存档不存在' }, 404);
      return jsonResponse(data);
    }
    if (path === '/api/saves') {
      const saves = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const m = k && k.match(/^bblv1_save_(.+)$/);
        if (!m) continue;
        const d = LS.get(k, null);
        if (d && d.meta) saves.push({
          slot: d.meta.slot, saved_at: d.meta.saved_at,
          player_name: (d.game_state && d.game_state.player && d.game_state.player.name) || '未知球员',
          story_stage: (d.game_state && d.game_state.story_stage) || '',
          team: (d.game_state && d.game_state.season && d.game_state.season.team) || ''
        });
      }
      saves.sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
      return jsonResponse({ success: true, saves });
    }
    if (path === '/api/save/delete' && method === 'POST') {
      if (!body.slot || !/^[a-zA-Z0-9_\-]+$/.test(body.slot)) return jsonResponse({ success: false, error: '非法存档槽名' }, 400);
      LS.del('bblv1_save_' + body.slot);
      return jsonResponse({ success: true });
    }

    // ---------- 快照 ----------
    if (path === '/api/snapshot' && method === 'POST') {
      if (!body.data) return jsonResponse({ success: false, error: 'Missing data' }, 400);
      const list = snapshots();
      const id = Date.now() + '_' + Math.random().toString(16).slice(2, 10);
      const snap = { id, label: body.label || '', created_at: new Date().toISOString(), data: body.data };
      list.push(snap);
      saveSnapshots(list);
      return jsonResponse({ success: true, id, created_at: snap.created_at });
    }
    if (path === '/api/snapshot/restore' && method === 'POST') {
      if (!body.id || !/^[a-zA-Z0-9_\-]+$/.test(body.id)) return jsonResponse({ success: false, error: '非法快照 id' }, 400);
      const snap = snapshots().find(s => s.id === body.id);
      if (!snap) return jsonResponse({ success: false, error: '快照不存在' }, 404);
      return jsonResponse({ success: true, ...snap });
    }
    if (path === '/api/snapshots') {
      const list = snapshots().slice().reverse().slice(0, 20)
        .map(s => ({ id: s.id, label: s.label, created_at: s.created_at }));
      return jsonResponse({ success: true, snapshots: list });
    }

    // ---------- LLM ----------
    if (path === '/api/llm/models' && method === 'GET') {
      try {
        const models = await listModels();
        return jsonResponse({ success: true, models });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message }, 500);
      }
    }
    if (path === '/api/llm/non-stream' && method === 'POST') {
      if (!body.prompt) return jsonResponse({ success: false, error: 'Missing prompt' }, 400);
      try {
        const content = await callLLM(body.prompt, body.system_prompt || '');
        return jsonResponse({ success: true, content });
      } catch (e) {
        return jsonResponse({ success: false, error: e.message }, 500);
      }
    }
    if (path === '/api/llm/stream' && method === 'POST') {
      if (!body.prompt) return jsonResponse({ success: false, error: 'Missing prompt' }, 400);
      // 原生取回全文后本地模拟分片流（打字机体验保留）
      let full;
      try { full = await callLLM(body.prompt, body.system_prompt || ''); }
      catch (e) {
        const enc = new TextEncoder();
        const stream = new ReadableStream({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`));
            c.close();
          }
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      }
      return sseResponse(full);
    }

    return jsonResponse({ success: false, error: 'API endpoint not found: ' + path }, 404);
  }

  // ---- 安装拦截器 ----
  window.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const path = u.replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/')) {
      return handleApi(u, opts);
    }
    return realFetch(url, opts);
  };

  console.log('[native] Capacitor 模式：/api/* 已切换为本地实现（localStorage + CapacitorHttp）');
})();
