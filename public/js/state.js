// ============================================================
// 篮球人生 - State Management & Serialization
// 实现 ##STATE## ... ##ENDSTATE## 协议（移植自 BBL_new 并适配通用世界观）
// ============================================================

window.BBL = window.BBL || {};

// ---- 默认初始状态 ----
BBL.getDefaultState = function() {
  return {
    player: {
      name: '球员',
      age: 16,
      position: 'SF',
      height: 188,
      weight: 80,
      charm: 50
    },
    attributes: {
      speed: 50,
      shooting: 50,
      dribbling: 50,
      defense: 50,
      strength: 50,
      stamina: 50,
      basketball_iq: 50
    },
    season: {
      year: 1,
      team: '',
      league: '',
      games_played: 0,
      stats: { ppg: 0, apg: 0, rpg: 0, spg: 0, bpg: 0, fg_pct: 0 },
      nextGame: { opponent: '待定', daysUntil: 7, location: '主场', goal: '' }
    },
    relationships: [],
    reputation: 10,
    story_stage: 'high_school',
    money: 50,
    energy: 100,
    narrativeHistory: [],
    memoryLog: []
  };
};

// ---- 从叙事文本中提取 ##STATE## 块 ----
BBL.extractState = function(text) {
  const startMarker = '##STATE##';
  const endMarker = '##ENDSTATE##';

  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return null;

  let jsonStr = text.substring(startIdx + startMarker.length).trim();

  const endIdx = jsonStr.indexOf(endMarker);
  if (endIdx !== -1) {
    jsonStr = jsonStr.substring(0, endIdx).trim();
  } else {
    // 无 ENDSTATE：截到闭合围栏 ``` 或选项分隔符为止（其后是协议/叙事残渣）
    let cutAt = -1;
    for (const stop of ['\n```', '\n---CHOICES---', '\n---CHOICE---']) {
      const i = jsonStr.indexOf(stop);
      if (i !== -1 && (cutAt === -1 || i < cutAt)) cutAt = i;
    }
    if (cutAt !== -1) jsonStr = jsonStr.substring(0, cutAt).trim();
  }

  // 剥离 LLM 可能包裹的 ```json 围栏
  jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.warn('[state] STATE JSON 解析失败:', e.message);
    return null;
  }
};

// ---- 关系字段归一化：LLM 可能输出 type/level/notes 等命名 ----
BBL.normalizeRelationships = function(state) {
  if (!state || !Array.isArray(state.relationships)) return state;
  state.relationships = state.relationships.map(function(r) {
    if (typeof r !== 'object' || r === null) return { name: '未知', relationship: '队友', status: '中立', trust: 0 };
    return {
      name: r.name || '未知',
      relationship: r.relationship || r.type || '队友',
      status: r.status || r.notes || '中立',
      trust: (typeof r.trust === 'number') ? r.trust : (typeof r.level === 'number' ? r.level : 0)
    };
  });
  return state;
};

// ---- 合并新状态到当前状态 ----
// 注意：LLM 输出的数值字段可能是字符串甚至 HTML 片段（XSS 风险），
// 合并时统一强转数字，非法值回退到合并前的值。
BBL.mergeState = function(currentState, newState) {
  if (!newState) return currentState;

  const merged = JSON.parse(JSON.stringify(currentState));
  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  if (newState.player) {
    Object.assign(merged.player, newState.player);
    for (const k of ['age', 'height', 'weight', 'charm', 'wingspan']) {
      merged.player[k] = num(merged.player[k], num(currentState.player?.[k], 0));
    }
  }
  if (newState.attributes) Object.assign(merged.attributes, newState.attributes);
  if (newState.season) {
    if (newState.season.stats) Object.assign(merged.season.stats, newState.season.stats);
    if (newState.season.nextGame) merged.season.nextGame = Object.assign({}, merged.season.nextGame, newState.season.nextGame);
    Object.assign(merged.season, newState.season, {
      stats: merged.season.stats,
      nextGame: merged.season.nextGame
    });
    for (const k in merged.season.stats) {
      merged.season.stats[k] = num(merged.season.stats[k], 0);
    }
    merged.season.games_played = num(merged.season.games_played, 0);
    merged.season.year = num(merged.season.year, merged.season.year);
    merged.season.nextGame.daysUntil = num(merged.season.nextGame.daysUntil, 7);
  }
  if (Array.isArray(newState.relationships)) merged.relationships = newState.relationships;
  if (newState.reputation !== undefined) merged.reputation = newState.reputation;
  if (newState.story_stage) merged.story_stage = newState.story_stage;
  if (newState.money !== undefined) merged.money = newState.money;
  if (newState.energy !== undefined) merged.energy = newState.energy;

  // 钳制：属性 0-99，精力 0-100，声望 >= 0
  for (const key in merged.attributes) {
    const v = Number(merged.attributes[key]);
    merged.attributes[key] = isNaN(v) ? 50 : Math.max(0, Math.min(99, v));
  }
  merged.energy = Math.max(0, Math.min(100, Number(merged.energy) || 0));
  merged.reputation = Math.max(0, Number(merged.reputation) || 0);
  if (typeof merged.money !== 'number') merged.money = Number(merged.money) || 0;

  return merged;
};

// ---- 序列化状态为 ##STATE## 块（用于把当前状态喂回 LLM）----
BBL.serializeState = function(state) {
  const slim = JSON.parse(JSON.stringify(state));
  delete slim.narrativeHistory;
  delete slim.memoryLog;
  return `##STATE##\n${JSON.stringify(slim, null, 2)}\n##ENDSTATE##`;
};

// ---- 清理叙事文本：剔除 STATE 块与 CHOICES 段 ----
BBL.cleanNarrative = function(text) {
  let out = text
    // 标准 ##STATE##...##ENDSTATE## 块
    .replace(/##STATE##[\s\S]*?##ENDSTATE##/g, '')
    // 围栏包裹且无 ENDSTATE：##STATE##\n```json ... ```
    .replace(/##STATE##\s*```[\s\S]*?```/g, '')
    // 截断的 STATE（无 ENDSTATE 无围栏）：删到结尾
    .replace(/##STATE##[\s\S]*$/g, '')
    // 强分隔符 ---CHOICES--- / ---CHOICE--- / --- 选择 --- 及其后内容
    .replace(/---\s*(?:CHOICES?|选择)\s*---[\s\S]*$/gi, '');

  // 弱分隔符（"选项："独占一行且后随编号行）才裁剪，避免误杀正文中"选择："字样
  const weak = out.match(/(?:选择|选项|CHOICES?)\s*[：:][ \t]*(?=\r?\n\s*\d[\.\、\)）])/i);
  if (weak) out = out.slice(0, weak.index);

  return out.trim();
};

// ---- 从叙事文本提取选项 ----
BBL.extractChoices = function(text) {
  const choices = [];

  // 剔除 STATE 块：闭合于 ENDSTATE 或围栏 ```；两者皆无则视为延伸到文末。
  // 不直接吞到文末，否则无 ENDSTATE 时会把其后的 ---CHOICES--- 段一并吃掉。
  let noState = text;
  const sIdx = text.indexOf('##STATE##');
  if (sIdx !== -1) {
    let eIdx = -1, eLen = 0;
    for (const [m, len] of [['##ENDSTATE##', 12], ['\n```', 4]]) {
      const j = text.indexOf(m, sIdx);
      if (j !== -1 && (eIdx === -1 || j < eIdx)) { eIdx = j; eLen = len; }
    }
    const end = eIdx === -1 ? text.length : eIdx + eLen;
    noState = text.slice(0, sIdx) + text.slice(end);
  }

  // 优先精确分隔符（最强标记）：---CHOICES--- / ---CHOICE--- / --- 选择 ---
  const strong = noState.match(/---\s*(?:CHOICES?|选择)\s*---/i);
  let choicesSection = null;
  if (strong) {
    choicesSection = noState.slice(strong.index + strong[0].length).trim();
  } else {
    // 弱标记仅当"选择：/选项："独占一行时可信（行首到冒号无其他文字）
    const weak = noState.match(/^[ \t]*(?:选择|选项|CHOICES?)[ \t]*[：:][ \t]*$/im);
    if (weak) choicesSection = noState.slice(weak.index + weak[0].length).trim();
  }

  if (!choicesSection) {
    // 回退：扫描末尾 10 行的数字行
    const lines = noState.trim().split('\n').slice(-10);
    for (const line of lines) {
      const match = line.trim().match(/^\d+[\.、\)）]\s*(.+)/);
      if (match) choices.push(match[1].trim());
    }
    return choices;
  }

  for (const line of choicesSection.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // 支持 1. / 1、/ 1) / 1）
    const match = trimmed.match(/^\d+[\.、\)）]\s*(.+)/);
    if (match) {
      choices.push(match[1].trim());
    } else if (choices.length && !trimmed.startsWith('##') && !trimmed.startsWith('---')) {
      // 选项跨行续接（跳过协议残渣行）
      choices[choices.length - 1] += ' ' + trimmed;
    }
  }

  return choices;
};

// ============================================================
// 存档（localStorage + 服务端双写）
// ============================================================

BBL.saveToLocal = function(slot, state) {
  try {
    const saveData = {
      meta: { slot, saved_at: new Date().toISOString(), version: '1.0.0' },
      game_state: state
    };
    localStorage.setItem(`bbl_save_${slot}`, JSON.stringify(saveData));
    return true;
  } catch (e) {
    console.warn('[state] localStorage 存档失败:', e.message);
    return false;
  }
};

BBL.loadFromLocal = function(slot) {
  try {
    const raw = localStorage.getItem(`bbl_save_${slot}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

BBL.deleteLocalSave = function(slot) {
  try { localStorage.removeItem(`bbl_save_${slot}`); return true; } catch { return false; }
};

BBL.saveToServer = async function(slot, state) {
  try {
    const resp = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot, data: state })
    });
    return await resp.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
};

BBL.loadFromServer = async function(slot) {
  try {
    const resp = await fetch(`/api/load/${slot}`);
    if (resp.status === 404) return null;
    return await resp.json();
  } catch {
    return null;
  }
};

BBL.listServerSaves = async function() {
  try {
    const resp = await fetch('/api/saves');
    const result = await resp.json();
    return result.success ? result.saves : [];
  } catch { return []; }
};

BBL.deleteServerSave = async function(slot) {
  try {
    const resp = await fetch('/api/save/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slot })
    });
    return await resp.json();
  } catch { return { success: false }; }
};

// 双写存档（服务端优先，localStorage 兜底）
BBL.saveGame = async function(slot, state) {
  BBL.saveToLocal(slot, state);
  return BBL.saveToServer(slot, state);
};

// ============================================================
// 快照系统 (ts / rs)
// ============================================================

BBL.takeSnapshot = async function(data, label) {
  try {
    const resp = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, label })
    });
    return await resp.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
};

BBL.restoreSnapshot = async function(id) {
  try {
    const resp = await fetch('/api/snapshot/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return await resp.json();
  } catch (e) {
    return { success: false, error: e.message };
  }
};

BBL.listSnapshots = async function() {
  try {
    const resp = await fetch('/api/snapshots');
    const result = await resp.json();
    return result.success ? result.snapshots : [];
  } catch { return []; }
};
