// ============================================================
// 篮球人生 - 主控制器
// 页面流程、开局生成、动作回合、存档、快照、设置
// ============================================================

window.BBL = window.BBL || {};
BBL.app = {
  state: null,
  mode: 'trial',          // 'llm' | 'trial'
  busy: false,
  turnToken: 0,           // 回合令牌：开局/读档/恢复/新回合自增；迟到的异步回调令牌不匹配则丢弃
  lastSnapshotId: null,   // 上一回合快照（用于回退/重生成）
  pendingAction: null,    // 本回合已执行的动作（重生成用）
  trialNext: null         // 试玩模式：当前节点的 next 指针
};

const $ = BBL.ui.$;

// ============================================================
// 初始化
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  bindTitle();
  bindCreate();
  bindGame();
  bindModals();

  // 标题屏显示 LLM 状态
  const ok = await BBL.llm.isConfigured();
  BBL.app.mode = ok ? 'llm' : 'trial';
  const el = $('#title-status');
  el.textContent = ok
    ? '● LLM 已配置 — 完整剧情生成模式'
    : '○ 未配置 API Key — 将使用试玩模式（可在设置中配置）';
  el.className = ok ? 'ok' : 'warn';

  await BBL.llm.loadTemplates();
  await BBL.worldbook.load();
});

function bindTitle() {
  $('#btn-new').onclick = () => BBL.ui.showScreen('create');
  $('#btn-continue').onclick = () => openSavesModal();
  $('#btn-settings').onclick = () => openSettingsModal('llm');
}

function bindCreate() {
  $('#create-back').onclick = () => BBL.ui.showScreen('title');

  const stageSel = $('#f-stage');
  stageSel.onchange = async () => {
    const teamSel = $('#f-team');
    teamSel.innerHTML = '<option value="">（由剧情决定）</option>';
    const teams = await BBL.worldbook.getTeams(stageSel.value);
    for (const t of teams) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name}（${t.league}）`;
      teamSel.appendChild(opt);
    }
  };

  $('#btn-start').onclick = () => {
    const profile = {
      name: $('#f-name').value.trim() || '林峰',
      position: $('#f-position').value,
      height: parseInt($('#f-height').value) || 188,
      weight: parseInt($('#f-weight').value) || 80,
      stage: $('#f-stage').value,
      team: $('#f-team').value || '',
      background: $('#f-background').value.trim()
    };
    startGame(profile);
  };
}

function bindGame() {
  $('#btn-send').onclick = submitFreeInput;
  $('#free-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.isComposing) submitFreeInput();
  });

  document.querySelectorAll('.game-header [data-act]').forEach(btn => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      if (act === 'snapshot') openSnapshotsModal();
      else if (act === 'regen') regenerate();
      else if (act === 'save') saveDialog();
      else if (act === 'settings') openSettingsModal('llm');
      else if (act === 'quit') quitToTitle();
    };
  });
}

function bindModals() {
  $('#modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') BBL.ui.hideModal();
  });
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => BBL.ui.hideModal());

  // 设置页 tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $('#tab-' + btn.dataset.tab).classList.add('active');
    };
  });

  $('#btn-save-config').onclick = saveConfig;
  $('#btn-save-prompts').onclick = savePrompts;
  $('#wb-select').onchange = loadWorldbookEditor;
  $('#btn-save-worldbook').onclick = saveWorldbook;
  $('#btn-refresh-saves').onclick = refreshSaves;
}

// ============================================================
// 开局
// ============================================================

async function startGame(profile) {
  BBL.ui.clearNarrative();
  BBL.ui.clearChoices();
  BBL.app.lastSnapshotId = null;
  BBL.app.pendingAction = null;
  BBL.app.trialNext = null;
  BBL.app.busy = false;
  BBL.app.turnToken++;    // 使上一局进行中的异步回调全部失效

  let state = BBL.getDefaultState();
  state.player.name = profile.name;
  state.player.position = profile.position;
  state.player.height = profile.height;
  state.player.weight = profile.weight;
  state.story_stage = profile.stage;
  if (profile.team) {
    state.season.team = profile.team;
    state.season.league = profile.stage.toUpperCase();
  }
  BBL.app.state = state;
  BBL.ui.renderSidebar(state);
  BBL.ui.showScreen('game');

  // 开局自动存档
  BBL.saveGame('auto', state);

  if (BBL.app.mode === 'llm') {
    await llmIntro(profile);
  } else {
    trialIntro(profile);
  }
}

function trialIntro(profile) {
  const token = ++BBL.app.turnToken;
  const node = BBL.game.trialIntro(profile);
  const block = BBL.ui.newNarrativeBlock();
  BBL.ui.typewrite(block, node.narrative).then(() => {
    if (token !== BBL.app.turnToken) return; // 期间被读档/新开局打断
    applyTrialNode(node, null);
  });
}

async function llmIntro(profile) {
  BBL.app.busy = true;
  const token = ++BBL.app.turnToken;
  BBL.ui.showThinking('球探正在撰写你的开局…');
  try {
    const tpl = BBL.llm.templates?.game_intro || '';
    const worldbook = await BBL.worldbook.formatForPrompt(BBL.app.state, '');
    const systemPrompt = await BBL.llm.getSystemPrompt();
    const prompt = BBL.llm.fillTemplate(tpl, {
      ...profile,
      stage: profile.stage,
      worldbook
    });
    const full = await BBL.llm._ll(prompt, systemPrompt);
    BBL.ui.hideThinking();
    if (token !== BBL.app.turnToken) return; // 期间被打断
    await processLLMOutput(full, null, { typewrite: true });
  } catch (e) {
    BBL.ui.hideThinking();
    if (token !== BBL.app.turnToken) return;
    BBL.ui.toast('LLM 开局失败，已切换试玩模式：' + e.message, 4000);
    BBL.app.mode = 'trial';
    trialIntro(profile);
  } finally {
    BBL.app.busy = false;
  }
}

// ============================================================
// 回合流程
// ============================================================

function submitFreeInput() {
  const input = $('#free-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  handleTurn(text);
}

// 处理一次玩家行动（选项点击或自由输入）。选项点击时 choiceIdx 为选项序号
async function handleTurn(action, choiceIdx) {
  if (BBL.app.busy) return;
  BBL.app.busy = true;
  BBL.ui.clearChoices();

  // 行动前拍快照（ts）
  try {
    const snap = await BBL.takeSnapshot(BBL.app.state, action.slice(0, 30));
    if (snap.success) {
      BBL.app.lastSnapshotId = snap.id;
    } else {
      // 快照失败置空，避免"重生成"回退到上上回合
      BBL.app.lastSnapshotId = null;
    }
  } catch {
    BBL.app.lastSnapshotId = null;
  }
  BBL.app.pendingAction = action;
  BBL.app.pendingChoiceIdx = (typeof choiceIdx === 'number') ? choiceIdx : null;

  if (BBL.app.mode === 'llm') {
    await llmTurn(action);
  } else {
    await trialTurn(action, choiceIdx);
  }

  BBL.app.busy = false;
}

// ---- LLM 回合：_ls 流式生成 ----
async function llmTurn(action) {
  BBL.ui.showThinking('命运正在转动…');
  const token = ++BBL.app.turnToken;
  let stream = null;
  try {
    const tpl = BBL.llm.templates?.game_action || '';
    const state = BBL.app.state;
    const worldbook = await BBL.worldbook.formatForPrompt(state, action);
    const systemPrompt = await BBL.llm.getSystemPrompt();
    const prompt = BBL.llm.fillTemplate(tpl, {
      state: BBL.serializeState(state),
      memory: BBL.memory.buildContext(state),
      worldbook,
      action
    });

    stream = BBL.ui.createStream();
    BBL.ui.hideThinking();
    const full = await BBL.llm._ls(prompt, systemPrompt, (delta) => stream.add(delta));
    if (token !== BBL.app.turnToken) return; // 期间被读档/新开局/回退打断
    stream.end();
    await processLLMOutput(full, action);
  } catch (e) {
    if (stream) stream.end('error');
    BBL.ui.hideThinking();
    if (token !== BBL.app.turnToken) return;
    BBL.ui.toast('生成失败：' + e.message + '（可点击"重生成"再试）', 4000);
    BBL.ui.renderChoices([], () => {});
  }
}

// 解析并落地 LLM 输出：叙事 / STATE / CHOICES
async function processLLMOutput(fullText, action, opts) {
  opts = opts || {};
  const token = BBL.app.turnToken;
  const narrative = BBL.cleanNarrative(fullText);
  const choices = BBL.extractChoices(fullText);
  const newState = BBL.extractState(fullText);

  // 空响应防御：LLM 返回为空或全是协议标记时提示重试，不落地任何状态
  if (!narrative || !narrative.trim()) {
    const blocks = document.querySelectorAll('#narrative-log .narrative-block');
    const block = blocks[blocks.length - 1] || BBL.ui.newNarrativeBlock();
    block.textContent = '（本回合生成内容为空，可能是模型或网络异常。点击"重生成"重试，或直接自由输入行动。）';
    block.classList.add('error');
    BBL.ui.renderChoices([], () => {});
    return;
  }

  // 用清洗后的文本替换流式输出（去掉可能的协议残渣）
  const blocks = document.querySelectorAll('#narrative-log .narrative-block');
  let block;
  if (blocks.length && !opts.typewrite) {
    block = blocks[blocks.length - 1];
    block.textContent = narrative;
  } else {
    block = BBL.ui.newNarrativeBlock();
    await BBL.ui.typewrite(block, narrative);
    if (token !== BBL.app.turnToken) return; // 打字期间被读档/恢复/新开局打断
  }

  if (newState) {
    BBL.normalizeRelationships(newState);
    BBL.app.state = BBL.mergeState(BBL.app.state, newState);
  }

  finishTurn(narrative, action, choices);
}

// ---- 试玩模式回合（await 打字机全程，busy 覆盖整个输出期）----
async function trialTurn(action, choiceIdx) {
  const token = ++BBL.app.turnToken;
  // trialNext 是当前节点的 next 数组，按选项序号取目标节点；自由输入或越界走通用节点
  const nextId = Array.isArray(BBL.app.trialNext)
    ? BBL.app.trialNext[choiceIdx ?? -1]
    : BBL.app.trialNext;
  const node = BBL.game.getNode(nextId, action);
  const block = BBL.ui.newNarrativeBlock();
  await BBL.ui.typewrite(block, node.narrative);
  if (token !== BBL.app.turnToken) return; // 期间被打断
  applyTrialNode(node, action);
}

// 应用试玩节点：patch 增量 / choices / next
function applyTrialNode(node, action) {
  const s = BBL.app.state;
  const patch = node.patch || {};
  if (patch.attributes) {
    for (const k in patch.attributes) {
      if (typeof s.attributes[k] === 'number') {
        s.attributes[k] = Math.max(0, Math.min(99, s.attributes[k] + patch.attributes[k]));
      }
    }
  }
  if (typeof patch.energy === 'number') s.energy = Math.max(0, Math.min(100, s.energy + patch.energy));
  if (typeof patch.reputation === 'number') s.reputation = Math.max(0, s.reputation + patch.reputation);
  if (Array.isArray(patch.relationships)) {
    s.relationships = s.relationships || [];
    for (const r of patch.relationships) {
      const exist = s.relationships.find(x => x.name === r.name);
      if (exist) exist.trust = (exist.trust || 0) + (r.trust || 0);
      else s.relationships.push(r);
    }
  }

  BBL.app.trialNext = node.next || null;
  finishTurn(node.narrative, action, node.choices || []);
}

// 回合收尾：记忆、UI、自动存档
function finishTurn(narrative, action, choices) {
  BBL.memory.record(BBL.app.state, narrative, action);
  BBL.ui.renderSidebar(BBL.app.state);
  BBL.ui.renderChoices(choices, (c, idx) => handleTurn(c, idx));
  BBL.saveGame('auto', BBL.app.state);
}

// ============================================================
// 快照恢复 / 重生成 (rs)
// ============================================================

async function restoreLastSnapshot() {
  if (!BBL.app.lastSnapshotId) {
    BBL.ui.toast('没有可恢复的快照');
    return null;
  }
  const snap = await BBL.restoreSnapshot(BBL.app.lastSnapshotId);
  if (!snap.success) {
    BBL.ui.toast('快照恢复失败：' + (snap.error || ''));
    return null;
  }
  BBL.app.state = snap.data;
  BBL.ui.removeLastNarrativeBlock();
  BBL.ui.renderSidebar(BBL.app.state);
  return true;
}

async function regenerate() {
  if (!BBL.app.state) return;
  if (BBL.app.busy) return;
  const restored = await restoreLastSnapshot();
  if (!restored) return;
  BBL.ui.hideModal();
  const action = BBL.app.pendingAction;
  // 恢复快照后 state 回到行动前；重放时带上原选项序号，保证试玩模式走同一剧情分支
  if (action) {
    BBL.app.lastSnapshotId = null;
    await handleTurn(action, BBL.app.pendingChoiceIdx ?? undefined);
  } else {
    BBL.ui.toast('已回退到上一回合');
  }
}

async function restoreSnapshotById(id) {
  if (BBL.app.busy) {
    BBL.ui.toast('生成进行中，请稍候…');
    return;
  }
  const snap = await BBL.restoreSnapshot(id);
  if (!snap.success) {
    BBL.ui.toast('恢复失败：' + (snap.error || ''));
    return;
  }
  BBL.app.turnToken++;    // 使进行中的生成回调失效
  BBL.app.state = snap.data;
  BBL.app.lastSnapshotId = null;
  BBL.app.pendingAction = null;
  BBL.ui.clearNarrative();
  BBL.ui.clearChoices();
  // 回放最近几段叙事
  const hist = (BBL.app.state.narrativeHistory || []).slice(-3);
  for (const h of hist) {
    const b = BBL.ui.newNarrativeBlock('restored');
    b.textContent = h.text;
  }
  if (hist.length) {
    BBL.ui.renderChoices(['继续训练', '找队友加练', '观看比赛录像'], c => handleTurn(c));
  } else {
    BBL.ui.toast('已恢复快照（开局状态）');
  }
  BBL.ui.renderSidebar(BBL.app.state);
  BBL.ui.hideModal();
  BBL.saveGame('auto', BBL.app.state);
}

// ============================================================
// 存档
// ============================================================

async function saveDialog() {
  // 用自定义弹窗命名（window.prompt 在内嵌浏览器/WebView 中会被静默拒绝）
  const input = $('#save-slot-input');
  input.value = '';
  BBL.ui.showModal('savebox');
  input.focus();
  input.onkeydown = async (e) => {
    if (e.key === 'Enter' && !e.isComposing) await confirmSaveDialog();
  };
  $('#btn-save-confirm').onclick = async () => confirmSaveDialog();
}

async function confirmSaveDialog() {
  const slot = ($('#save-slot-input').value.trim() || 'slot1').replace(/[^a-zA-Z0-9_\-]/g, '');
  if (!slot) {
    BBL.ui.toast('存档名仅限英文/数字/下划线/连字符');
    return;
  }
  const r = await BBL.saveGame(slot, BBL.app.state);
  BBL.ui.hideModal();
  BBL.ui.toast(r.success ? `已存档到 ${slot}` : '存档失败：' + (r.error || ''));
}

async function openSavesModal() {
  BBL.ui.showModal('saves');
  refreshSaves();
}

async function refreshSaves() {
  const saves = await BBL.listServerSaves();
  BBL.ui.renderSaves(saves, {
    onLoad: async (slot) => { await loadSlot(slot); },
    onDelete: async (slot) => {
      await BBL.deleteServerSave(slot);
      BBL.deleteLocalSave(slot);
      refreshSaves();
    }
  });
}

async function loadSlot(slot) {
  const data = await BBL.loadFromServer(slot);
  if (!data || !data.game_state) {
    BBL.ui.toast('读档失败');
    return;
  }
  BBL.app.turnToken++;    // 使进行中的生成回调失效
  BBL.app.state = data.game_state;
  BBL.app.lastSnapshotId = null;
  BBL.app.pendingAction = null;
  BBL.ui.clearNarrative();
  BBL.ui.clearChoices();
  const hist = (BBL.app.state.narrativeHistory || []).slice(-3);
  for (const h of hist) {
    const b = BBL.ui.newNarrativeBlock('restored');
    b.textContent = h.text;
  }
  BBL.ui.renderSidebar(BBL.app.state);
  BBL.ui.renderChoices(['继续训练', '找队友加练', '观看比赛录像'], c => handleTurn(c));
  BBL.ui.showScreen('game');
  BBL.ui.hideModal();
  BBL.ui.toast(`已读取存档 ${slot}`);
}

async function quitToTitle() {
  if (BBL.app.busy) {
    BBL.ui.toast('生成进行中，请稍候…');
    return;
  }
  BBL.app.turnToken++;    // 使残留的异步回调失效
  if (BBL.app.state) await BBL.saveGame('auto', BBL.app.state);
  BBL.ui.showScreen('title');
}

// ============================================================
// 快照列表弹窗
// ============================================================

async function openSnapshotsModal() {
  BBL.ui.showModal('snapshots');
  const snaps = await BBL.listSnapshots();
  BBL.ui.renderSnapshots(snaps, id => restoreSnapshotById(id));
}

// ============================================================
// 设置弹窗
// ============================================================

async function openSettingsModal(tab) {
  BBL.ui.showModal('settings');
  const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab || 'llm'}"]`);
  if (tabBtn) tabBtn.click();

  // LLM 配置
  const r = await (await fetch('/api/config')).json();
  if (r.success) {
    $('#cfg-baseurl').value = r.config.base_url || '';
    $('#cfg-model').value = r.config.model || '';
    $('#cfg-apikey').value = r.config.api_key_masked || '';
    $('#cfg-apikey').placeholder = r.config.has_api_key ? '已配置（保持不变请勿修改）' : 'sk-...';
  }

  // 自定义提示词 + 内置默认（供查看）
  const p = await (await fetch('/api/prompts/custom')).json();
  if (p.success) {
    $('#pr-system').value = p.prompts.system_prompt || '';
    $('#pr-unrestricted').value = p.prompts.unrestricted_prompt || '';
  }
  const d = await (await fetch('/api/prompts/default')).json();
  if (d.success && d.prompts.system_prompt) {
    $('#pr-system-default').value = d.prompts.system_prompt;
  }

  // 世界书下拉
  const wb = await (await fetch('/api/worldbook')).json();
  const sel = $('#wb-select');
  sel.innerHTML = '';
  if (wb.success) {
    for (const name of Object.keys(wb.worldbook)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = `${name}.json`;
      sel.appendChild(opt);
    }
    if (sel.options.length) loadWorldbookEditor();
  }
}

async function saveConfig() {
  const body = {
    base_url: $('#cfg-baseurl').value.trim(),
    model: $('#cfg-model').value.trim(),
    api_key: $('#cfg-apikey').value.trim()
  };
  const r = await (await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();
  if (r.success) {
    BBL.app.mode = r.config.has_api_key ? 'llm' : 'trial';
    BBL.ui.toast('配置已保存');
  } else {
    BBL.ui.toast('保存失败：' + (r.error || ''));
  }
}

async function savePrompts() {
  const body = {
    system_prompt: $('#pr-system').value,
    unrestricted_prompt: $('#pr-unrestricted').value
  };
  const r = await (await fetch('/api/prompts/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })).json();
  BBL.ui.toast(r.success ? '提示词已保存' : '保存失败：' + (r.error || ''));
}

async function loadWorldbookEditor() {
  const name = $('#wb-select').value;
  if (!name) return;
  const r = await (await fetch('/api/worldbook')).json();
  if (r.success && r.worldbook[name]) {
    const wb = r.worldbook[name];
    $('#wb-editor').value = JSON.stringify(wb, null, 2);
    const teams = Array.isArray(wb.teams) ? wb.teams.length : 0;
    const players = Array.isArray(wb.teams)
      ? wb.teams.reduce((n, t) => n + (t.players?.length || 0) + (t.foreign_players?.length || 0), 0)
      : 0;
    $('#wb-stats').textContent = `${teams} 支 / 球员 ${players} 名`;
  }
}

async function saveWorldbook() {
  const name = $('#wb-select').value;
  if (!name) return;
  let content;
  try {
    content = JSON.parse($('#wb-editor').value);
  } catch (e) {
    BBL.ui.toast('JSON 格式错误：' + e.message, 4000);
    return;
  }
  const r = await (await fetch('/api/worldbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content })
  })).json();
  if (r.success) {
    BBL.worldbook.invalidate();
    BBL.ui.toast(`世界书 ${name} 已保存`);
  } else {
    BBL.ui.toast('保存失败：' + (r.error || ''));
  }
}
