// ============================================================
// 篮球人生 - UI 渲染组件
// 屏幕切换、叙事输出、选项、侧栏、模态框、toast
// ============================================================

window.BBL = window.BBL || {};
BBL.ui = {};

BBL.ui.$ = (sel) => document.querySelector(sel);

// ---- 屏幕切换 ----
BBL.ui.showScreen = function(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
};

// ---- Toast ----
let _toastTimer = null;
BBL.ui.toast = function(msg, ms) {
  const el = BBL.ui.$('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2500);
};

// ============================================================
// 叙事输出
// ============================================================

// 追加一个叙事区块（空容器），返回该 DOM 元素
BBL.ui.newNarrativeBlock = function(cls) {
  const log = BBL.ui.$('#narrative-log');
  const block = document.createElement('div');
  block.className = 'narrative-block ' + (cls || '');
  log.appendChild(block);
  log.closest('#narrative-area').scrollTop = log.closest('#narrative-area').scrollHeight;
  return block;
};

// 清除最后一个叙事区块（用于快照回退/重生成）
BBL.ui.removeLastNarrativeBlock = function() {
  const log = BBL.ui.$('#narrative-log');
  const blocks = log.querySelectorAll('.narrative-block');
  if (blocks.length) blocks[blocks.length - 1].remove();
};

BBL.ui.clearNarrative = function() {
  BBL.ui.$('#narrative-log').innerHTML = '';
};

// 打字机效果输出完整文本（非流式/试玩模式用）
BBL.ui.typewrite = async function(el, text, cps) {
  const speed = 1000 / (cps || 120); // 每字符间隔
  const chunk = 2;
  for (let i = 0; i < text.length; i += chunk) {
    el.textContent += text.slice(i, i + chunk);
    const area = BBL.ui.$('#narrative-area');
    area.scrollTop = area.scrollHeight;
    if (!BBL.ui._skipType) await new Promise(r => setTimeout(r, speed));
  }
};

// 流式叙事句柄：add(delta) 增量追加，end() 收尾
// 自动在检测到 ##STATE## / ---CHOICES--- / ``` 后停止向界面输出协议内容。
// 标记可能跨分片到达，用 pending 缓冲：输出安全前缀，保留可能是标记前缀的尾部。
BBL.ui.createStream = function() {
  const block = BBL.ui.newNarrativeBlock('streaming');
  const CUT_MARKERS = ['##STATE##', '---CHOICES---', '```'];
  const CUT_LEN = Math.max(...CUT_MARKERS.map(m => m.length));
  let cut = false;
  let pending = '';

  const emit = (safe) => {
    if (!safe) return;
    block.textContent += safe;
    const area = BBL.ui.$('#narrative-area');
    area.scrollTop = area.scrollHeight;
  };

  return {
    block,
    add(delta) {
      if (cut || !delta) return;
      pending += delta;
      const hit = CUT_MARKERS.reduce((best, m) => {
        const i = pending.indexOf(m);
        return (i !== -1 && (best === -1 || i < best)) ? i : best;
      }, -1);
      if (hit !== -1) {
        emit(pending.slice(0, hit));
        pending = '';
        cut = true;
        return;
      }
      // 无标记：保留尾部（可能是不完整标记前缀）不输出
      const keep = CUT_LEN - 1;
      if (pending.length > keep) {
        const safe = pending.slice(0, pending.length - keep);
        pending = pending.slice(-keep);
        emit(safe);
      }
    },
    end(cls) {
      if (!cut && pending) { emit(pending); pending = ''; }
      block.classList.remove('streaming');
      if (cls) block.classList.add(cls);
    }
  };
};

// ============================================================
// 选项渲染
// ============================================================

BBL.ui.renderChoices = function(choices, onChoose) {
  const area = BBL.ui.$('#choices-area');
  area.innerHTML = '';
  BBL.ui.$('#free-input').disabled = false;
  BBL.ui.$('#btn-send').disabled = false;

  const bar = BBL.ui.$('#action-bar');
  const tg = BBL.ui.$('#choices-toggle');

  if (!choices || choices.length === 0) {
    if (tg) tg.classList.add('hidden');
    if (bar) bar.classList.remove('collapsed');
    return;
  }
  choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `<span class="choice-idx">${i + 1}</span><span class="choice-text"></span>`;
    btn.querySelector('.choice-text').textContent = c;
    btn.onclick = () => onChoose(c, i);
    area.appendChild(btn);
  });
  // 新一轮选项：更新计数并自动展开
  if (tg) {
    tg.classList.remove('hidden');
    tg.setAttribute('aria-expanded', 'true');
    const label = tg.querySelector('.ct-label');
    if (label) label.textContent = `选项 · ${choices.length}`;
  }
  if (bar) bar.classList.remove('collapsed');
};

BBL.ui.clearChoices = function() {
  BBL.ui.$('#choices-area').innerHTML = '';
  BBL.ui.$('#free-input').disabled = true;
  BBL.ui.$('#btn-send').disabled = true;
  const tg = BBL.ui.$('#choices-toggle');
  if (tg) tg.classList.add('hidden');
  const bar = BBL.ui.$('#action-bar');
  if (bar) bar.classList.remove('collapsed');
};

// 流式生成中显示加载指示
BBL.ui.showThinking = function(text) {
  let el = BBL.ui.$('#thinking');
  if (!el) {
    el = document.createElement('div');
    el.id = 'thinking';
    el.className = 'thinking';
    BBL.ui.$('#narrative-log').appendChild(el);
  }
  el.textContent = '';
  const dot = document.createElement('span');
  dot.className = 'dot-flash';
  dot.textContent = '●';
  el.appendChild(dot);
  el.appendChild(document.createTextNode(' ' + (text || '球探正在撰写你的命运…')));
  el.style.display = '';
};
BBL.ui.hideThinking = function() {
  const el = BBL.ui.$('#thinking');
  if (el) el.remove();
};

// ============================================================
// 侧栏（状态面板）
// ============================================================

const ATTR_CN = {
  speed: '速度', shooting: '投篮', dribbling: '运球', defense: '防守',
  strength: '力量', stamina: '体能', basketball_iq: '球商'
};

function attrBar(label, value) {
  const n = Number(value);
  const pct = Math.max(0, Math.min(99, Number.isFinite(n) ? Math.round(n) : 0));
  return `<div class="attr-row">
    <span class="attr-label">${label}</span>
    <div class="attr-track"><div class="attr-fill" style="width:${pct}%"></div></div>
    <span class="attr-val">${pct}</span>
  </div>`;
}

BBL.ui.renderSidebar = function(state) {
  const sb = BBL.ui.$('#sidebar');
  if (!state) { sb.innerHTML = ''; return; }
  const p = state.player || {};
  const s = state.season || {};
  const st = s.stats || {};
  const ng = s.nextGame || {};
  // 数值字段一律强转（旧存档/畸形 LLM 输出兜底），非法显示 '?'
  const nOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

  const rels = (state.relationships || []).map(r =>
    `<div class="rel-item">
      <span class="rel-name">${BBL.esc(r.name || '')}</span>
      <span class="rel-type">${BBL.esc(r.relationship || '')}</span>
      <span class="rel-trust">${nOr(r.trust, '')}</span>
    </div>`);

  sb.innerHTML = `
    <div class="panel player-panel">
      <div class="player-name">${BBL.esc(p.name || '球员')}</div>
      <div class="player-sub">${BBL.esc(p.position || '')} · ${nOr(p.age, '?')}岁 · ${nOr(p.height, '?')}cm/${nOr(p.weight, '?')}kg</div>
      <div class="player-sub stage">阶段: ${BBL.esc(state.story_stage || '')}</div>
    </div>
    <div class="panel">
      <div class="panel-title">ATTRIBUTES · 属性</div>
      ${Object.entries(ATTR_CN).map(([k, cn]) => attrBar(cn, (state.attributes || {})[k] ?? 50)).join('')}
      <div class="gauge-row"><span>精力</span><b>${nOr(state.energy, 0)}/100</b></div>
      <div class="gauge-row"><span>声望</span><b>${nOr(state.reputation, 0)}</b></div>
      <div class="gauge-row"><span>金钱</span><b>¥${Math.round(nOr(state.money, 0))}</b></div>
    </div>
    <div class="panel">
      <div class="panel-title">SEASON · 赛季</div>
      <div class="kv"><span>球队</span><b>${BBL.esc(s.team || '无')}</b></div>
      <div class="kv"><span>联赛</span><b>${BBL.esc(s.league || '')}</b></div>
      <div class="kv"><span>场次</span><b>${nOr(s.games_played, 0)}</b></div>
      <div class="stat-line">${nOr(st.ppg, 0)}分 / ${nOr(st.rpg, 0)}板 / ${nOr(st.apg, 0)}助</div>
      ${ng.opponent ? `<div class="next-game">下场: vs ${BBL.esc(ng.opponent)}（${BBL.esc(ng.location || '')}，${nOr(ng.daysUntil, '?')}天后）</div>` : ''}
    </div>
    <div class="panel">
      <div class="panel-title">RELATIONSHIPS · 人际</div>
      ${rels.length ? rels.join('') : '<div class="muted">暂无</div>'}
    </div>`;
};

// ---- HTML 转义 ----
BBL.esc = function(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
};

// ============================================================
// 模态框
// ============================================================

BBL.ui.showModal = function(name) {
  BBL.ui.$('#modal-overlay').classList.remove('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  const m = document.getElementById('modal-' + name);
  if (m) m.classList.add('active');
};

BBL.ui.hideModal = function() {
  BBL.ui.$('#modal-overlay').classList.add('hidden');
};

// 渲染存档列表
BBL.ui.renderSaves = function(saves, handlers) {
  const box = BBL.ui.$('#saves-list');
  if (!saves.length) {
    box.innerHTML = '<div class="muted">暂无存档</div>';
    return;
  }
  box.innerHTML = '';
  saves.forEach(sv => {
    const row = document.createElement('div');
    row.className = 'save-row';
    row.innerHTML = `
      <div class="save-info">
        <b></b>
        <span class="muted">${BBL.esc(sv.slot)} · ${BBL.esc(sv.player_name)} ${sv.team ? '· ' + BBL.esc(sv.team) : ''}</span>
        <span class="muted small">${BBL.esc(new Date(sv.saved_at).toLocaleString('zh-CN'))}</span>
      </div>
      <div class="save-ops">
        <button class="btn small" data-op="load">读取</button>
        <button class="btn small danger" data-op="del">删除</button>
      </div>`;
    row.querySelector('b').textContent = sv.slot === 'auto' ? '自动存档' : `存档 ${sv.slot}`;
    row.querySelector('[data-op=load]').onclick = () => handlers.onLoad(sv.slot);
    row.querySelector('[data-op=del]').onclick = () => handlers.onDelete(sv.slot);
    box.appendChild(row);
  });
};

// 渲染快照列表
BBL.ui.renderSnapshots = function(snaps, onRestore) {
  const box = BBL.ui.$('#snapshots-list');
  if (!snaps.length) {
    box.innerHTML = '<div class="muted">暂无快照（每回合行动前会自动拍摄）</div>';
    return;
  }
  box.innerHTML = '';
  snaps.forEach(sn => {
    const row = document.createElement('div');
    row.className = 'save-row';
    row.innerHTML = `
      <div class="save-info">
        <b>快照</b>
        <span class="muted small">${BBL.esc(sn.label || '回合前')}</span>
        <span class="muted small">${BBL.esc(new Date(sn.created_at).toLocaleString('zh-CN'))}</span>
      </div>
      <div class="save-ops"><button class="btn small">恢复</button></div>`;
    row.querySelector('button').onclick = () => onRestore(sn.id);
    box.appendChild(row);
  });
};
