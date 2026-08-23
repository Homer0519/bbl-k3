// ============================================================
// 篮球人生 - LLM 客户端
// _ll: 非流式（开局生成）  _ls: 流式 SSE（动作生成）
// ============================================================

window.BBL = window.BBL || {};
BBL.llm = {};

// 缓存的提示词模板
BBL.llm.templates = null;

BBL.llm.loadTemplates = async function() {
  if (BBL.llm.templates) return BBL.llm.templates;
  try {
    const resp = await fetch('/api/prompts/default');
    const result = await resp.json();
    BBL.llm.templates = result.prompts;
  } catch {
    BBL.llm.templates = null;
  }
  return BBL.llm.templates;
};

// 获取最终 system prompt（基础 + 用户自填无限制提示词，服务端组装）
BBL.llm.getSystemPrompt = async function() {
  try {
    const resp = await fetch('/api/prompts/system');
    const result = await resp.json();
    return result.system_prompt || '';
  } catch {
    return '';
  }
};

// 检测 LLM 是否可用
BBL.llm.isConfigured = async function() {
  try {
    const resp = await fetch('/api/config');
    const result = await resp.json();
    return !!(result.config && result.config.has_api_key);
  } catch {
    return false;
  }
};

// 简单模板填充：把 {key} 替换为 params[key]
BBL.llm.fillTemplate = function(template, params) {
  return template.replace(/\{(\w+)\}/g, (m, key) => {
    const v = params[key];
    return v === undefined || v === null ? m : String(v);
  });
};

// ---- _ll 非流式调用 ----
BBL.llm._ll = async function(prompt, systemPrompt) {
  const resp = await fetch('/api/llm/non-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system_prompt: systemPrompt })
  });
  const result = await resp.json();
  if (!result.success) throw new Error(result.error || 'LLM 调用失败');
  return result.content;
};

// ---- _ls 流式调用（SSE）。onDelta(text) 逐段回调，返回完整文本 ----
BBL.llm._ls = async function(prompt, systemPrompt, onDelta) {
  const resp = await fetch('/api/llm/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system_prompt: systemPrompt })
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`LLM 流式请求失败 HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  let full = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const msg = JSON.parse(trimmed.slice(5).trim());
    if (msg.type === 'delta' && msg.content) {
      full += msg.content;
      if (onDelta) onDelta(msg.content, full);
    } else if (msg.type === 'error') {
      throw new Error(msg.error || 'LLM 流式错误');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of raw.split('\n')) {
          try { handleLine(line); }
          catch (e) { if (e instanceof SyntaxError) continue; throw e; }
        }
      }
    }
    // 尾部 flush：不以 \n\n 结尾的最后一个事件 + 跨块多字节字符
    buf += decoder.decode();
    for (const line of buf.split('\n')) {
      try { handleLine(line); }
      catch (e) { if (e instanceof SyntaxError) continue; throw e; }
    }
  } finally {
    // 出错/提前退出时释放上游连接
    reader.cancel().catch(() => {});
  }

  return full;
};
