// ============================================================
// 篮球人生 - 世界书
// 按 story_stage 与叙事文本关键词选择性注入 prompt，控制 token 消耗
// ============================================================

window.BBL = window.BBL || {};
BBL.worldbook = {};

BBL.worldbook._cache = null;

// 加载全部世界书（缓存）
BBL.worldbook.load = async function() {
  if (BBL.worldbook._cache) return BBL.worldbook._cache;
  try {
    const resp = await fetch('/api/worldbook');
    const result = await resp.json();
    BBL.worldbook._cache = result.worldbook || {};
  } catch {
    BBL.worldbook._cache = {};
  }
  return BBL.worldbook._cache;
};

BBL.worldbook.invalidate = function() {
  BBL.worldbook._cache = null;
};

// story_stage 匹配：条目 stages 数组中任一值是 story_stage 的前缀（如 cba 匹配 cba_rookie）
BBL.worldbook._stageMatch = function(book, storyStage) {
  if (!storyStage) return false;
  return (book.stages || []).some(s => storyStage.startsWith(s));
};

// 某舞台下可选球队列表（用于开局选队）
BBL.worldbook.getTeams = async function(stage) {
  const books = await BBL.worldbook.load();
  const teams = [];
  for (const book of Object.values(books)) {
    if (!BBL.worldbook._stageMatch(book, stage)) continue;
    for (const t of book.teams || []) {
      teams.push({ name: t.name, cn: t.cn || t.name, league: book.name });
    }
  }
  return teams;
};

// 球队条目 → 紧凑文本
BBL.worldbook._formatTeam = function(team, full) {
  const lines = [`【${team.name}${team.cn && team.cn !== team.name ? '(' + team.cn + ')' : ''}】` +
    `${team.city ? ' 城市:' + team.city : ''}${team.arena ? ' 主场:' + team.arena : ''}` +
    `${team.head_coach ? ' 主教练:' + team.head_coach : ''}` +
    `${team.style ? ' 风格:' + team.style : ''}`];

  const players = team.players || [];
  if (full) {
    for (const p of players) {
      lines.push(`- ${p.name} #${p.number || '?'} ${p.position || ''} ${p.height ? p.height + 'cm' : ''} ${p.age ? p.age + '岁' : ''}：${p.desc || ''}`);
    }
    for (const p of team.foreign_players || []) {
      lines.push(`- (外援)${p.name} #${p.number || '?'} ${p.position || ''}：${p.desc || ''}`);
    }
  } else {
    lines.push('- 球员：' + players.map(p => `${p.name}(${p.position || '?'})`).join('、'));
  }
  return lines.join('\n');
};

// 从队伍列表中选出玩家所属球队：先精确匹配 name/cn，
// 再按"命中关键词最长者优先"做包含匹配（避免"北京"撞上"北京控股"这类误配）
BBL.worldbook._pickOwnTeam = function(teams, team) {
  if (!team) return null;
  const exact = teams.find(t => t.name === team || t.cn === team);
  if (exact) return exact;

  let best = null, bestLen = 0;
  for (const t of teams) {
    for (const k of (t.keywords || [])) {
      if (team.includes(k) && k.length > bestLen) {
        best = t;
        bestLen = k.length;
      }
    }
  }
  return best;
};

// 生成注入 prompt 的世界书文本
// state: 当前游戏状态；recentText: 最近叙事（用于关键词命中）
BBL.worldbook.formatForPrompt = async function(state, recentText) {
  const books = await BBL.worldbook.load();
  const stage = state?.story_stage || '';
  const team = state?.season?.team || '';
  const text = (recentText || '') + ' ' + team;

  const sections = [];

  for (const book of Object.values(books)) {
    const stageHit = BBL.worldbook._stageMatch(book, stage);
    // 关键词命中（即使不在该舞台，叙事提及该联赛也注入概况）
    const keywordHit = (book.keywords || []).some(k => text.includes(k));

    if (!stageHit && !keywordHit) continue;

    let section = `# ${book.name}\n${book.league_intro || ''}`;

    const teams = book.teams || [];
    // 玩家所属球队：完整名单
    const ownTeam = BBL.worldbook._pickOwnTeam(teams, team);
    if (ownTeam) {
      section += `\n\n## 你所在的球队（完整名单）\n${BBL.worldbook._formatTeam(ownTeam, true)}`;
    }

    // 叙事中提及的其他球队：简要名单（最多 3 支，同样最长关键词优先去歧义）
    const mentioned = [];
    for (const t of teams) {
      if (t === ownTeam) continue;
      const names = [t.name, t.cn, ...(t.keywords || [])].filter(n => n && n.length >= 2);
      const hitLen = names.reduce((mx, n) => text.includes(n) ? Math.max(mx, n.length) : mx, 0);
      if (hitLen > 0) mentioned.push({ t, hitLen });
    }
    mentioned.sort((a, b) => b.hitLen - a.hitLen);
    for (const { t } of mentioned.slice(0, 3)) {
      section += `\n\n${BBL.worldbook._formatTeam(t, false)}`;
    }

    sections.push(section);
  }

  if (sections.length === 0) return '（当前阶段无世界书条目，可自由发挥虚构球队与人物）';
  return sections.join('\n\n') + '\n\n（以上名单为世界观事实，涉及这些球队时必须使用真实名字，不得编造名单外球员）';
};
