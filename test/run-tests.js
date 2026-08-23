// ============================================================
// 篮球人生 — 单元测试（无框架，纯 assert）
// 覆盖: state.js 协议解析/合并/清洗、game.js 剧情树、memory.js
// 用法: node test/run-tests.js
// ============================================================

global.window = global;
const fs = require('fs');
const path = require('path');

// 加载被测脚本（浏览器脚本挂 window.BBL；后续裸 BBL 走全局解析，勿建局部绑定）
for (const f of ['state.js', 'memory.js', 'worldbook.js', 'game.js', 'native.js']) {
  eval(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf-8'));
}

let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ✗ ${name}`);
    console.log(`      ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function assertEq(actual, expected, msg) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg || '不等'}: 实际 ${JSON.stringify(actual)} ≠ 期望 ${JSON.stringify(expected)}`);
  }
}

console.log('\n== extractState ==');

test('标准 ##STATE##...##ENDSTATE##', () => {
  const st = BBL.extractState('叙事...\n##STATE##\n{"reputation": 12}\n##ENDSTATE##\n后续');
  assertEq(st, { reputation: 12 });
});

test('缺失 ##ENDSTATE## 时容错', () => {
  const st = BBL.extractState('叙事\n##STATE##\n{"money": 66}');
  assertEq(st, { money: 66 });
});

test('剥离 ```json 围栏', () => {
  const st = BBL.extractState('##STATE##\n```json\n{"energy": 50}\n```\n##ENDSTATE##');
  assertEq(st, { energy: 50 });
});

test('截断的 JSON 返回 null（不抛异常）', () => {
  const st = BBL.extractState('##STATE##\n{"player": {"na');
  assertEq(st, null);
});

test('围栏包裹且无 ENDSTATE（后随 CHOICES 段）仍可解析', () => {
  const t = '叙事。\n##STATE##\n```json\n{"energy": 50}\n```\n\n---CHOICES---\n1. A';
  assertEq(BBL.extractState(t), { energy: 50 });
});

test('无标记返回 null', () => {
  assertEq(BBL.extractState('纯叙事没有状态'), null);
});

test('STATE 出现在 CHOICES 之后仍可提取', () => {
  const st = BBL.extractState('叙事\n---CHOICES---\n1. A\n##STATE##\n{"money": 1}\n##ENDSTATE##');
  assertEq(st, { money: 1 });
});

console.log('\n== extractChoices ==');

test('标准 ---CHOICES--- 数字行', () => {
  const c = BBL.extractChoices('叙事\n---CHOICES---\n1. 训练\n2. 休息\n3. 单挑');
  assertEq(c, ['训练', '休息', '单挑']);
});

test('---CHOICE--- 单数形式', () => {
  const c = BBL.extractChoices('x\n---CHOICE---\n1. A\n2. B');
  assertEq(c, ['A', 'B']);
});

test('中文冒号 "选项：" 分隔', () => {
  const c = BBL.extractChoices('x\n选项：\n1. A\n2. B');
  assertEq(c, ['A', 'B']);
});

test('"Choices:" 英文冒号', () => {
  const c = BBL.extractChoices('x\nChoices:\n1) A\n2) B');
  assertEq(c, ['A', 'B']);
});

test('中文顿号 "1、A" 格式', () => {
  const c = BBL.extractChoices('---CHOICES---\n1、加练\n2、休息');
  assertEq(c, ['加练', '休息']);
});

test('全角括号 "1）A" 格式', () => {
  const c = BBL.extractChoices('---CHOICES---\n1）A\n2）B');
  assertEq(c, ['A', 'B']);
});

test('无分隔符时回退扫描末尾数字行', () => {
  const c = BBL.extractChoices('很长的叙事第一行\n第二行\n1. 选项甲\n2. 选项乙');
  assertEq(c, ['选项甲', '选项乙']);
});

test('选项跨行续接合并', () => {
  const c = BBL.extractChoices('---CHOICES---\n1. 去力量房\n练核心\n2. 休息');
  assertEq(c, ['去力量房 练核心', '休息']);
});

test('无任何选项返回空数组', () => {
  assertEq(BBL.extractChoices('纯叙事'), []);
});

console.log('\n== cleanNarrative ==');

test('剔除 STATE 块与 CHOICES 尾部', () => {
  const out = BBL.cleanNarrative('正文内容。\n##STATE##\n{}\n##ENDSTATE##\n---CHOICES---\n1. A');
  assertEq(out, '正文内容。');
});

test('围栏式 STATE 残留清理', () => {
  const out = BBL.cleanNarrative('正文。\n##STATE##\n```json\n{}\n```');
  assertEq(out, '正文。');
});

console.log('\n== mergeState ==');

test('部分属性只覆盖给定键', () => {
  const cur = BBL.getDefaultState();
  const merged = BBL.mergeState(cur, { attributes: { shooting: 60 } });
  assertEq(merged.attributes.shooting, 60);
  assertEq(merged.attributes.speed, 50);
});

test('属性钳制 0-99（150→99, -5→0）', () => {
  const cur = BBL.getDefaultState();
  const m = BBL.mergeState(cur, { attributes: { shooting: 150, speed: -5 } });
  assertEq([m.attributes.shooting, m.attributes.speed], [99, 0]);
});

test('energy 钳制 0-100', () => {
  const cur = BBL.getDefaultState();
  assertEq(BBL.mergeState(cur, { energy: 130 }).energy, 100);
  assertEq(BBL.mergeState(cur, { energy: -10 }).energy, 0);
});

test('energy 字符串数字被转换', () => {
  const m = BBL.mergeState(BBL.getDefaultState(), { energy: "30" });
  assertEq(m.energy, 30);
});

test('非法属性值回退 50', () => {
  const m = BBL.mergeState(BBL.getDefaultState(), { attributes: { speed: "abc" } });
  assertEq(m.attributes.speed, 50);
});

test('nextGame 深合并保留未给字段', () => {
  const cur = BBL.getDefaultState();
  const m = BBL.mergeState(cur, { season: { nextGame: { daysUntil: 1 } } });
  assertEq(m.season.nextGame.daysUntil, 1);
  assertEq(m.season.nextGame.opponent, '待定');
});

test('stats 深合并', () => {
  const m = BBL.mergeState(BBL.getDefaultState(), { season: { stats: { ppg: 12.5 } } });
  assertEq(m.season.stats.ppg, 12.5);
  assertEq(m.season.stats.apg, 0);
});

test('relationships 整体替换', () => {
  const cur = BBL.getDefaultState();
  cur.relationships = [{ name: '旧', relationship: 'x', status: 'y', trust: 1 }];
  const m = BBL.mergeState(cur, { relationships: [{ name: '新', relationship: '教练', status: 'z', trust: 9 }] });
  assertEq(m.relationships.length, 1);
  assertEq(m.relationships[0].name, '新');
});

test('null newState 返回原状态', () => {
  const cur = BBL.getDefaultState();
  const m = BBL.mergeState(cur, null);
  assertEq(m.player.name, cur.player.name);
});

test('合并不污染原对象', () => {
  const cur = BBL.getDefaultState();
  const snapshot = JSON.stringify(cur);
  BBL.mergeState(cur, { attributes: { speed: 99 } });
  assertEq(JSON.stringify(cur), snapshot);
});

console.log('\n== normalizeRelationships ==');

test('type/level/notes 变体归一化', () => {
  const st = { relationships: [{ name: '李', type: '队友', notes: '友好', level: 20 }] };
  BBL.normalizeRelationships(st);
  assertEq(st.relationships[0], { name: '李', relationship: '队友', status: '友好', trust: 20 });
});

test('非对象元素兜底', () => {
  const st = { relationships: [null, '垃圾'] };
  BBL.normalizeRelationships(st);
  assertEq(st.relationships.length, 2);
  assertEq(st.relationships[0].name, '未知');
});

console.log('\n== serializeState ==');

test('序列化剔除历史字段并 round-trip', () => {
  const cur = BBL.getDefaultState();
  cur.narrativeHistory = [{ text: 'x' }];
  cur.memoryLog = ['y'];
  const block = BBL.serializeState(cur);
  assert(block.startsWith('##STATE##'));
  assert(block.endsWith('##ENDSTATE##'));
  const parsed = JSON.parse(block.replace(/^##STATE##\n/, '').replace(/\n##ENDSTATE##$/, ''));
  assert(!('narrativeHistory' in parsed) && !('memoryLog' in parsed), '历史字段应被剔除');
});

test('序列化结果可被 extractState 解析', () => {
  const cur = BBL.getDefaultState();
  const back = BBL.extractState(BBL.serializeState(cur) + '\n---CHOICES---\n1. A');
  assertEq(back.player.name, cur.player.name);
});

console.log('\n== memory ==');

test('record 记录叙事与动作摘要', () => {
  const s = BBL.getDefaultState();
  BBL.memory.record(s, '今天你完成了第一堂训练课，表现出色。', '加练');
  assertEq(s.narrativeHistory.length, 1);
  assertEq(s.memoryLog.length, 1);
  assert(s.memoryLog[0].includes('[选择:加练]'), '摘要应含动作');
});

test('buildContext 编号列出最近 8 条', () => {
  const s = BBL.getDefaultState();
  for (let i = 1; i <= 10; i++) BBL.memory.record(s, `第${i}段剧情内容`, `动作${i}`);
  const ctx = BBL.memory.buildContext(s);
  const lines = ctx.split('\n');
  assertEq(lines.length, 8);
  assert(lines[0].includes('动作3'), '应从第3条开始（最近8条）');
});

test('超上限裁剪（history 12 / log 30）', () => {
  const s = BBL.getDefaultState();
  for (let i = 0; i < 35; i++) BBL.memory.record(s, '剧情' + i, null);
  assertEq(s.narrativeHistory.length, 12);
  assertEq(s.memoryLog.length, 30);
});

console.log('\n== game.js 剧情树 ==');

test('所有 next 指针指向存在节点或 auto', () => {
  for (const [id, node] of Object.entries(BBL.game.nodes)) {
    assert(Array.isArray(node.choices) && node.choices.length >= 3, `${id} 需≥3个选项`);
    if (node.next) {
      assertEq(node.next.length, node.choices.length, `${id} 的 next 与 choices 数量不匹配`);
      for (const n of node.next) {
        assert(n === 'auto' || BBL.game.nodes[n], `${id}.next 指向不存在的节点 ${n}`);
      }
    }
  }
});

test('每个节点都有叙事与增量 patch', () => {
  for (const [id, node] of Object.entries(BBL.game.nodes)) {
    assert(typeof node.narrative === 'string' && node.narrative.length > 50, `${id} 叙事过短`);
    assert(node.patch && typeof node.patch === 'object', `${id} 缺 patch`);
  }
});

test('trialIntro 替换校名', () => {
  const node = BBL.game.trialIntro({ school: '振华中学' });
  assert(node.narrative.includes('振华中学'), '校名未替换');
});

test('genericNode 嵌入行动文本且结构合法', () => {
  const node = BBL.game.genericNode('凌晨四点加练');
  assert(node.narrative.includes('凌晨四点加练'));
  assert(Array.isArray(node.choices) && node.choices.length === 3);
  assert(node.patch.attributes && Object.keys(node.patch.attributes).length >= 1);
});

test('getNode 未知 id 走通用节点', () => {
  const node = BBL.game.getNode('不存在', '测试行动');
  assert(node.narrative.includes('测试行动'));
});

console.log('\n== worldbook 工具函数 ==');

test('_stageMatch 前缀匹配', () => {
  const book = { stages: ['cba'] };
  assert(BBL.worldbook._stageMatch(book, 'cba_rookie'));
  assert(BBL.worldbook._stageMatch(book, 'cba'));
  assert(!BBL.worldbook._stageMatch(book, 'nba_allstar'));
  assert(!BBL.worldbook._stageMatch(book, ''));
});

test('_formatTeam 完整/简要两种模式', () => {
  const team = {
    name: 'Shanghai Sharks', cn: '上海大鲨鱼', city: '上海', arena: '上海体育馆',
    head_coach: '卢伟', style: '冠军之师',
    players: [{ name: '王哲林', number: 94, position: 'C', height: 214, age: 32, desc: '核心中锋' }],
    foreign_players: [{ name: '古德温', number: 0, position: 'PG', desc: 'FMVP' }]
  };
  const full = BBL.worldbook._formatTeam(team, true);
  assert(full.includes('王哲林') && full.includes('(外援)古德温') && full.includes('主教练:卢伟'));
  const brief = BBL.worldbook._formatTeam(team, false);
  assert(brief.includes('王哲林(C)') && !brief.includes('核心中锋'), '简要模式不应含描述');
});

console.log('\n== 脏输入容错（审查修复回归） ==');

test('叙事正文含"选择："不误切（强分隔符优先）', () => {
  const t = '教练把你叫到办公室："关于未来，你需要做出选择：\n1. 留在青年队等待机会\n2. 申请租借到低级别联赛"\n那天晚上你辗转反侧。\n---CHOICES---\n1. 主动找教练摊牌\n2. 默默加练证明自己\n3. 联系经纪人';
  const c = BBL.extractChoices(t);
  assertEq(c, ['主动找教练摊牌', '默默加练证明自己', '联系经纪人']);
  assert(!BBL.cleanNarrative(t).includes('留在青年队'), '清洗后不应残留正文中的伪选项');
});

test('STATE 块内 "choices": 键不干扰分隔符识别', () => {
  const t = '叙事。\n##STATE##\n{ "choices": ["x"], "energy": 50 }\n##ENDSTATE##\n---CHOICES---\n1. 真·选项甲\n2. 真·选项乙';
  assertEq(BBL.extractChoices(t), ['真·选项甲', '真·选项乙']);
});

test('mergeState 字符串型 player 字段强转（XSS 防御）', () => {
  const cur = BBL.getDefaultState();
  const m = BBL.mergeState(cur, {
    player: { height: '<img src=x onerror=alert(1)>', age: '十八岁', weight: '80kg' }
  });
  assertEq(typeof m.player.height, 'number', 'height 应被强转');
  assertEq(m.player.height, cur.player.height, '非法 height 应回退原值');
  assertEq(typeof m.player.age, 'number', 'age 应被强转');
  assertEq(m.player.age, cur.player.age, '非法 age 应回退原值');
  assertEq(m.player.weight, 80, '"80kg" 应解析出 80');
});

test('mergeState 字符串型 stats/games_played 强转', () => {
  const cur = BBL.getDefaultState();
  const m = BBL.mergeState(cur, { season: { stats: { ppg: '<script>alert(1)</script>' }, games_played: '3' } });
  assertEq(m.season.stats.ppg, 0, '非法 ppg 应为 0');
  assertEq(m.season.games_played, 3);
});

test('cleanNarrative 剔除单数 ---CHOICE--- 尾部', () => {
  assertEq(BBL.cleanNarrative('正文。\n---CHOICE---\n1. A'), '正文。');
});

test('cleanNarrative 剔除独占一行弱分隔符及其后', () => {
  assertEq(BBL.cleanNarrative('正文。\n选项：\n1. A\n2. B'), '正文。');
});

test('cleanNarrative 剔除无 ENDSTATE 的截断 STATE 块', () => {
  assertEq(BBL.cleanNarrative('正文。\n##STATE##\n{"player": {"na'), '正文。');
});

test('_pickOwnTeam 城市撞名不误配（北京控股 ≠ 北京北汽）', () => {
  const teams = [
    { name: '北京北汽', cn: '北京首钢', keywords: ['北汽', '首钢', '北京首钢', '霹雳鸭'] },
    { name: '北京控股', cn: '北控紫金勇士', keywords: ['北控', '北京控股', '紫金勇士'] }
  ];
  assertEq(BBL.worldbook._pickOwnTeam(teams, '北京控股').name, '北京控股');
  assertEq(BBL.worldbook._pickOwnTeam(teams, '北京北汽').name, '北京北汽');
  assertEq(BBL.worldbook._pickOwnTeam(teams, '北控').name, '北京控股');
  assertEq(BBL.worldbook._pickOwnTeam(teams, '上海久事大鲨鱼'), null);
});

console.log('\n== APK 原生层 ==');

test('native.js 在无 Capacitor 环境（Web 版）完全惰性', () => {
  assertEq(BBL.NATIVE, false, 'Web 版不应激活原生层');
});

test('打包资产与源同步（prompts/worldbook）', () => {
  const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assertEq(src('public/prompts-default.json'), src('prompts-default.json'), 'prompts-default 不同步');
  for (const w of ['cba', 'nba']) {
    assertEq(src(`public/worldbook/${w}.json`), src(`worldbook/${w}.json`), `worldbook/${w} 不同步`);
  }
});

test('prompts-default.json 占位符完整', () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'prompts-default.json'), 'utf8'));
  assert(d.system_prompt.includes('篮球人生模拟游戏引擎'), 'system_prompt 异常');
  for (const p of ['{name}', '{position}', '{height}', '{stage}', '{worldbook}']) {
    assert(d.game_intro.includes(p), 'intro 缺占位符 ' + p);
  }
  for (const p of ['{state}', '{memory}', '{worldbook}', '{action}']) {
    assert(d.game_action.includes(p), 'action 缺占位符 ' + p);
  }
});

console.log('\n== 世界书数据完整性 ==');

test('cba.json 结构合法且 20 队', () => {
  const cba = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'worldbook', 'cba.json'), 'utf-8'));
  assertEq(cba.teams.length, 20);
  assert(Array.isArray(cba.stages) && cba.stages.includes('cba'));
  const names = new Set(cba.teams.map(t => t.name));
  assertEq(names.size, 20, '队名重复');
  for (const t of cba.teams) {
    assert(t.name && Array.isArray(t.players) && t.players.length >= 3, `${t.name} 球员过少`);
    assert(Array.isArray(t.keywords) && t.keywords.length >= 1, `${t.name} 缺 keywords`);
  }
});

test('nba.json 结构合法且 30 队', () => {
  const nba = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'worldbook', 'nba.json'), 'utf-8'));
  assertEq(nba.teams.length, 30);
  const east = nba.conferences.east.length, west = nba.conferences.west.length;
  assertEq(east + west, 30, '东西部分区数量不符');
  const teamNames = new Set(nba.teams.map(t => t.name));
  for (const conf of ['east', 'west']) {
    for (const n of nba.conferences[conf]) {
      assert(teamNames.has(n), `分区球队 ${n} 不在 teams 列表中`);
    }
  }
  for (const t of nba.teams) {
    assert(Array.isArray(t.players) && t.players.length >= 3, `${t.name} 球员过少`);
    assert(Array.isArray(t.keywords) && t.keywords.length >= 1, `${t.name} 缺 keywords`);
  }
});

console.log('\n============================================');
console.log(`  合计: ${passed} 通过 / ${failed} 失败`);
console.log('============================================\n');
process.exit(failed > 0 ? 1 : 0);
