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
  $('#btn-fetch-models').onclick = fetchModels;
  $('#cfg-model-select').onchange = () => {
    const v = $('#cfg-model-select').value;
    if (v) $('#cfg-model').value = v;
  };
  $('#btn-save-prompts').onclick = savePrompts;
  $('#btn-profile-save').onclick = () => {
    $('#profile-name-input').value = $('#cfg-profile-select').value || '';
    BBL.ui.showModal('profile');
  };
  $('#btn-profile-confirm').onclick = saveProfileAs;
  $('#btn-profile-apply').onclick = applyProfile;
  $('#btn-profile-delete').onclick = deleteProfile;
  $('#btn-import-preset').onclick = () => $('#preset-file').click();
  $('#preset-file').onchange = importTavernPreset;
  $('#btn-tavern-all-on').onclick = () => tavernSetAll(true);
  $('#btn-tavern-all-off').onclick = () => tavernSetAll(false);
  $('#btn-tavern-clear').onclick = clearTavernPreset;
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
  BBL.app.pendingIntro = false;
  BBL.app.pendingProfile = null;
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

  // 开局前拍快照（初始状态），使"重生成"可重 roll 开局
  try {
    const snap = await BBL.takeSnapshot(BBL.app.state, '开局');
    BBL.app.lastSnapshotId = snap.success ? snap.id : null;
  } catch { BBL.app.lastSnapshotId = null; }
  BBL.app.pendingProfile = profile;
  BBL.app.pendingIntro = true;

  BBL.ui.showThinking('球探正在撰写你的开局…');
  let stream = null;
  try {
    const tpl = BBL.llm.templates?.game_intro || '';
    const worldbook = await BBL.worldbook.formatForPrompt(BBL.app.state, '');
    const systemPrompt = await BBL.llm.getSystemPrompt();
    const prompt = BBL.llm.fillTemplate(tpl, {
      ...profile,
      stage: profile.stage,
      worldbook
    });
    stream = BBL.ui.createStream();
    let firstDelta = false;
    const full = await BBL.llm._ls(prompt, systemPrompt, (delta) => {
      if (!firstDelta) { firstDelta = true; BBL.ui.hideThinking(); } // 首字节到达才隐藏思考标识
      stream.add(delta);
    });
    BBL.ui.hideThinking();
    if (token !== BBL.app.turnToken) return; // 期间被打断
    stream.end();
    await processLLMOutput(full, null);
  } catch (e) {
    if (stream) stream.end('error');
    BBL.ui.hideThinking();
    if (token !== BBL.app.turnToken) return;
    BBL.ui.toast('开局生成失败：' + e.message + '（可点击"重生成"重试）', 4000);
    BBL.ui.renderChoices([], () => {});
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
  BBL.app.pendingIntro = false; // 进入正常回合后不再是"开局"阶段

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
    let firstDelta = false;
    const full = await BBL.llm._ls(prompt, systemPrompt, (delta) => {
      if (!firstDelta) { firstDelta = true; BBL.ui.hideThinking(); } // 首字节到达才隐藏思考标识
      stream.add(delta);
    });
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
  // 开局阶段的重 roll：恢复初始快照后重新流式生成开局
  if (BBL.app.pendingIntro && BBL.app.pendingProfile) {
    BBL.app.lastSnapshotId = null;
    BBL.app.pendingIntro = false; // llmIntro 会重新拍快照并置位
    await llmIntro(BBL.app.pendingProfile);
    return;
  }
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
  BBL.app.pendingIntro = false;
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
  BBL.app.pendingIntro = false;
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
  if (r.success) fillConfigForm(r.config);
  await loadProfiles();

  // 自定义提示词 + 内置默认（供查看）
  const p = await (await fetch('/api/prompts/custom')).json();
  if (p.success) {
    $('#pr-system').value = p.prompts.system_prompt || '';
    $('#pr-unrestricted').value = p.prompts.unrestricted_prompt || '';
    tavernPreset = (p.prompts.tavern_preset && Array.isArray(p.prompts.tavern_preset.prompts))
      ? normalizeTavernPreset(p.prompts.tavern_preset) : null;
    renderTavernList();
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

// 拉取上游模型列表（GET /api/llm/models），填充下拉
async function fetchModels() {
  const btn = $('#btn-fetch-models');
  const status = $('#model-status');
  const sel = $('#cfg-model-select');

  // 未保存的草稿也要能试：先按当前表单值即时生效（不落盘）
  const draft = {
    base_url: $('#cfg-baseurl').value.trim(),
    model: $('#cfg-model').value.trim(),
    api_key: $('#cfg-apikey').value.trim()
  };
  const keyIsMasked = draft.api_key.includes('****');
  try {
    if (draft.base_url && draft.api_key && !keyIsMasked) {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft)
      });
    }
  } catch { /* 草稿应用失败则按已保存配置尝试 */ }

  btn.disabled = true;
  status.textContent = '获取中…';
  sel.classList.add('hidden');
  try {
    const r = await (await fetch('/api/llm/models')).json();
    if (!r.success || !Array.isArray(r.models) || r.models.length === 0) {
      throw new Error(r.error || '未返回任何模型');
    }
    sel.innerHTML = '';
    for (const m of r.models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    }
    // 当前模型不在列表中时置顶提示项
    const cur = $('#cfg-model').value.trim();
    if (cur && !r.models.includes(cur)) {
      const opt = document.createElement('option');
      opt.value = cur;
      opt.textContent = cur + '（当前，列表外）';
      opt.selected = true;
      sel.insertBefore(opt, sel.firstChild);
    } else if (cur) {
      sel.value = cur;
    }
    sel.classList.remove('hidden');
    status.textContent = `获取成功：${r.models.length} 个模型`;
  } catch (e) {
    status.textContent = '获取失败：' + e.message;
    BBL.ui.toast('模型列表获取失败：' + e.message, 3500);
  } finally {
    btn.disabled = false;
  }
}

async function saveConfig() {
  const body = currentConfigDraft();
  if (!body) return;
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

// 读取当前表单为配置对象（采样参数：空串→清除，非法数字→报错返回 null）
function currentConfigDraft() {
  const body = {
    base_url: $('#cfg-baseurl').value.trim(),
    model: $('#cfg-model').value.trim(),
    api_key: $('#cfg-apikey').value.trim(),
    api_type: $('#cfg-api-type').value
  };
  const SAMPLING = [['#cfg-temperature', 'temperature'], ['#cfg-top-p', 'top_p'], ['#cfg-top-k', 'top_k'],
    ['#cfg-presence', 'presence_penalty'], ['#cfg-frequency', 'frequency_penalty'], ['#cfg-max-tokens', 'max_tokens']];
  for (const [sel, key] of SAMPLING) {
    const raw = $(sel).value.trim();
    if (raw === '') { body[key] = ''; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n)) { BBL.ui.toast(`采样参数 ${key} 不是有效数字`); return null; }
    body[key] = n;
  }
  return body;
}

// 把 config 视图填回表单
function fillConfigForm(c) {
  $('#cfg-baseurl').value = c.base_url || '';
  $('#cfg-model').value = c.model || '';
  $('#cfg-api-type').value = c.api_type === 'responses' ? 'responses' : 'chat_completions';
  $('#cfg-apikey').value = c.api_key_masked || '';
  $('#cfg-apikey').placeholder = c.has_api_key ? '已配置（保持不变请勿修改）' : 'sk-...';
  const SAMPLING = [['#cfg-temperature', 'temperature'], ['#cfg-top-p', 'top_p'], ['#cfg-top-k', 'top_k'],
    ['#cfg-presence', 'presence_penalty'], ['#cfg-frequency', 'frequency_penalty'], ['#cfg-max-tokens', 'max_tokens']];
  for (const [sel, key] of SAMPLING) {
    $(sel).value = typeof c[key] === 'number' ? String(c[key]) : '';
  }
}

async function loadProfiles() {
  const sel = $('#cfg-profile-select');
  const r = await (await fetch('/api/config/profiles')).json();
  sel.innerHTML = '<option value="">— 已存方案 —</option>';
  if (r.success) {
    for (const p of r.profiles) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = `${p.name}（${p.model || '?'} @ ${(p.base_url || '').replace(/^https?:\/\//, '').slice(0, 28)}）`;
      sel.appendChild(o);
    }
    $('#profile-status').textContent = r.profiles.length
      ? `已存 ${r.profiles.length} 套方案。选中后「应用」立即生效。`
      : '把当前 Base URL / 模型 / Key / 采样参数存成方案，多套 API 一键切换。';
  }
}

async function saveProfileAs() {
  const name = $('#profile-name-input').value.trim();
  if (!name) { BBL.ui.toast('请填写方案名称'); return; }
  const draft = currentConfigDraft();
  if (!draft) return;
  const r = await (await fetch('/api/config/profiles/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...draft, name })
  })).json();
  if (r.success) {
    document.querySelector('#modal-profile [data-close]').click();
    await loadProfiles();
    $('#cfg-profile-select').value = name;
    BBL.ui.toast(`方案「${name}」已保存`);
  } else {
    BBL.ui.toast('保存失败：' + (r.error || ''));
  }
}

async function applyProfile() {
  const name = $('#cfg-profile-select').value;
  if (!name) { BBL.ui.toast('先选择一个方案'); return; }
  const r = await (await fetch('/api/config/profiles/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })).json();
  if (r.success) {
    fillConfigForm(r.config);
    BBL.app.mode = r.config.has_api_key ? 'llm' : 'trial';
    BBL.ui.toast(`已切换到「${name}」`);
  } else {
    BBL.ui.toast('应用失败：' + (r.error || ''));
  }
}

async function deleteProfile() {
  const name = $('#cfg-profile-select').value;
  if (!name) { BBL.ui.toast('先选择一个方案'); return; }
  if (!confirm(`删除方案「${name}」？（不影响当前生效配置）`)) return;
  const r = await (await fetch('/api/config/profiles/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  })).json();
  if (r.success) {
    await loadProfiles();
    BBL.ui.toast('方案已删除');
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

// ============================================================
// 酒馆（SillyTavern）预设管理器
// 参考 SillyTavern Prompt Manager：预设 JSON 含 prompts[]（identifier/name/
// role/content/marker）与 prompt_order[]（真实启用状态与顺序）。
// 导入后整份预设存入 prompts.json 的 tavern_preset 字段；逐条开关/编辑即时保存；
// 最终 system prompt = 基础 + 启用条目（按序拼接，marker 跳过）+ 追加提示词，
// 拼接在服务端 buildSystemPrompt / native.js 本地完成。
// ============================================================

let tavernPreset = null; // 当前载入的酒馆预设（就地修改后整体保存）

// 归一化：以 prompts[] 数组顺序为准（即酒馆里的可见/拖拽顺序），
// prompt_order 只作为启用状态的来源；缺省条目保持预设自带 enabled 或默认启用
function normalizeTavernPreset(preset) {
  const enabledMap = new Map();
  for (const po of (preset.prompt_order || [])) {
    for (const o of (po && po.order) || []) {
      if (o && o.identifier && !enabledMap.has(o.identifier)) {
        enabledMap.set(o.identifier, o.enabled !== false);
      }
    }
  }
  const order = [];
  for (const p of preset.prompts) {
    if (!p || !p.identifier) continue;
    const enabled = enabledMap.has(p.identifier)
      ? enabledMap.get(p.identifier)
      : p.enabled !== false;
    order.push({ identifier: p.identifier, enabled });
  }
  preset.prompt_order = [{ character_id: 100001, order }];
  return preset;
}

function tavernOrder() { return tavernPreset.prompt_order[0].order; }
function tavernById() {
  const byId = {};
  for (const p of tavernPreset.prompts) if (p && p.identifier) byId[p.identifier] = p;
  return byId;
}

function renderTavernList() {
  const list = $('#tavern-list');
  list.innerHTML = '';
  const has = !!tavernPreset;
  for (const id of ['#btn-tavern-all-on', '#btn-tavern-all-off', '#btn-tavern-clear']) {
    $(id).classList.toggle('hidden', !has);
  }
  if (!has) return;

  const byId = tavernById();
  let enabledCount = 0;
  for (const o of tavernOrder()) {
    const p = byId[o.identifier];
    if (!p) continue;
    if (o.enabled && !p.marker) enabledCount++;

    const row = document.createElement('div');
    row.className = 'tavern-row' + (o.enabled ? '' : ' off') + (p.marker ? ' marker' : '');

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!o.enabled;
    toggle.className = 'tavern-toggle';
    toggle.title = p.marker ? 'marker 占位条目（内容为空，不参与拼接）' : '启用/停用';
    toggle.onchange = () => {
      o.enabled = toggle.checked;
      row.classList.toggle('off', !o.enabled);
      saveTavernPreset();
      updateTavernStatus();
    };

    const name = document.createElement('span');
    name.className = 'tavern-name';
    name.textContent = (p.marker ? '📌 ' : '') + (p.name || p.identifier);

    const role = document.createElement('span');
    role.className = 'tavern-role';
    role.textContent = p.role || 'system';

    const len = document.createElement('span');
    len.className = 'tavern-len muted small';
    len.textContent = (p.content || '').trim().length + ' 字';

    row.append(toggle, name, role, len);

    // 点击名字展开/收起编辑框
    const editor = document.createElement('textarea');
    editor.className = 'tavern-editor hidden';
    editor.rows = 6;
    editor.spellcheck = false;
    editor.value = p.content || '';
    let t;
    editor.oninput = () => {
      p.content = editor.value;
      len.textContent = editor.value.trim().length + ' 字';
      clearTimeout(t);
      t = setTimeout(saveTavernPreset, 600);
    };
    name.onclick = () => editor.classList.toggle('hidden');

    list.append(row, editor);
  }
  updateTavernStatus();
}

function updateTavernStatus() {
  if (!tavernPreset) return;
  const total = tavernOrder().length;
  const on = tavernOrder().filter(o => o.enabled).length;
  $('#preset-import-status').textContent =
    `已载入「${tavernPreset.name || '未命名预设'}」：共 ${total} 条，启用 ${on} 条。改动自动保存。`;
}

async function saveTavernPreset() {
  if (!tavernPreset) return;
  const r = await (await fetch('/api/prompts/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tavern_preset: tavernPreset })
  })).json();
  if (!r.success) BBL.ui.toast('预设保存失败：' + (r.error || ''));
}

function tavernSetAll(on) {
  if (!tavernPreset) return;
  for (const o of tavernOrder()) o.enabled = on;
  renderTavernList();
  saveTavernPreset();
}

async function clearTavernPreset() {
  if (!tavernPreset) return;
  if (!confirm('清除已导入的酒馆预设？（不影响基础/追加提示词）')) return;
  tavernPreset = null;
  await fetch('/api/prompts/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tavern_preset: null })
  });
  renderTavernList();
  $('#preset-import-status').textContent = '已清除。可重新导入 SillyTavern 预设 JSON。';
  BBL.ui.toast('酒馆预设已清除');
}

async function importTavernPreset(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  const status = $('#preset-import-status');
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    status.textContent = '文件过大（>2MB），不像预设文件';
    return;
  }
  let preset;
  try {
    preset = JSON.parse(await file.text());
  } catch {
    status.textContent = '解析失败：不是有效的 JSON 文件';
    return;
  }
  if (!preset || typeof preset !== 'object' || !Array.isArray(preset.prompts) || preset.prompts.length === 0) {
    status.textContent = '未识别：该 JSON 不含 prompts[]（仅支持聊天补全「提示词管理器」预设）';
    return;
  }
  tavernPreset = normalizeTavernPreset(preset);
  renderTavernList();
  await saveTavernPreset();
  BBL.ui.toast('预设已导入，可逐条开关');
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
