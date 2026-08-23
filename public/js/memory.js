// ============================================================
// 篮球人生 - 剧情记忆管理
// narrativeHistory 保存最近叙事原文，memoryLog 保存压缩摘要
// 每回合把摘要注入动作 prompt，防止剧情失忆
// ============================================================

window.BBL = window.BBL || {};
BBL.memory = {};

const MAX_HISTORY = 12;   // 保留最近叙事条数
const MAX_LOG = 30;       // 保留摘要条数

// 记录一段叙事（已清洗过的纯叙事文本）
BBL.memory.record = function(state, narrative, action) {
  if (!state || !narrative) return;
  state.narrativeHistory = state.narrativeHistory || [];
  state.narrativeHistory.push({
    action: action || null,
    text: narrative.slice(0, 1500),
    at: Date.now()
  });
  if (state.narrativeHistory.length > MAX_HISTORY) {
    state.narrativeHistory = state.narrativeHistory.slice(-MAX_HISTORY);
  }

  // 生成压缩摘要：首句 + 关键信息
  const summary = narrative
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim();
  state.memoryLog = state.memoryLog || [];
  state.memoryLog.push((action ? `[选择:${action.slice(0, 40)}] ` : '[开局] ') + summary);
  if (state.memoryLog.length > MAX_LOG) {
    state.memoryLog = state.memoryLog.slice(-MAX_LOG);
  }
};

// 构建注入 prompt 的记忆摘要（最近若干条）
BBL.memory.buildContext = function(state) {
  if (!state || !Array.isArray(state.memoryLog) || state.memoryLog.length === 0) {
    return '（尚无历史剧情）';
  }
  const recent = state.memoryLog.slice(-8);
  return recent.map((s, i) => `${i + 1}. ${s}`).join('\n');
};
