// ============================================================
// 篮球人生 - 游戏引擎：试玩模式（LLM 不可用时的预设剧情）
// 节点式剧情树 + 通用节点兜底（自由输入也能继续玩）
// ============================================================

window.BBL = window.BBL || {};
BBL.game = {};

// ---- 预设剧情节点 ----
// 每个节点：narrative 叙事 / patch 状态增量 / choices 选项数组
// 选项按顺序对应 next 中的目标节点 id；next 为 'auto' 时走通用节点
BBL.game.nodes = {
  start: {
    narrative: `九月的午后，阳光斜切进明诚中学的旧球馆，地板上的划痕像老人手背的血管。你攥着背包带站在门口，听着里面皮球砸地的闷响一声声敲在心上。

今天是校队新赛季试训的第一天。公告栏上贴着名单——四十七个名字，最后只留十五个。

场边那个抱着战术板、眉头拧成疙瘩的中年人是主教练老周，出了名的严厉。助教小李正招呼新人排队登记："高一的站左边！先来三组折返跑热身！"

你换了鞋，深吸一口气，踏进球馆。命运的第一步，从这里开始。`,
    patch: { energy: -5 },
    choices: [
      '折返跑拼到最前，用态度给教练留下第一印象',
      '热身时悄悄加练投篮，找一找手感',
      '主动帮器材管理员捡球，顺便认识几个学长'
    ],
    next: ['hardwork', 'shoot', 'social']
  },

  hardwork: {
    narrative: `三组折返跑，你每组都冲在最前面。第三组结束时双腿灌了铅，胃里翻江倒海，但你咬牙没让自己弯腰。

老周的眼睛从战术板上抬了起来，在你身上停了足足三秒。

"那个高一的，"他敲了敲战术板，"叫什么？"

"报告教练，试训第38号！"

周围的学长们交换着眼神——被主教练记住名字，在第一天，是福是祸还不好说。但你的肺还在燃烧，心里却烧起另一团火。

防守演练分组时，老周指了指二队："38号，去二队，盯他们最强的得分点。"`,
    patch: { attributes: { stamina: 3, defense: 2 }, energy: -20, reputation: 2 },
    choices: [
      '死缠对方核心，哪怕犯规也要展示血性',
      '保持冷静站位，用预判代替蛮力',
      '边防边喊位，指挥队友协防'
    ],
    next: ['defense_blood', 'defense_smart', 'defense_lead']
  },

  shoot: {
    narrative: `别人跑完步瘫在场边，你拎着球溜到底角，开始加练投篮。

一记、两记……第七记三分应声入网时，你听见身后有人说："手感不错啊，学弟。"

回头，是校队队长、高二的主力得分后卫陈皓宇。他捡起球，掂了掂："敢不敢比一场？定点十个球。"

你接过球。掌心的汗让皮球有点滑，但你的心跳反而慢了下来——这种时刻，你等了很久。

十球之后，你6中，他8中。他咧嘴笑了，露出虎牙："差得远，但胆子够大。老周最缺你这种不要命的投手。"`,
    patch: { attributes: { shooting: 4 }, energy: -10, reputation: 1 },
    relationships: [
      { name: '陈皓宇', relationship: '队友/队长', status: '欣赏你的胆量', trust: 15 }
    ],
    choices: [
      '追问陈皓宇自己的投篮短板，虚心求教',
      '提出每天早训一小时，请他监督',
      '默默加练到球馆熄灯'
    ],
    next: ['auto', 'auto', 'auto']
  },

  social: {
    narrative: `你帮器材管理员王叔把散落的球一筐筐收进推车，顺势和几个学长搭上了话。

"新来的？哪个初中的？"一个高个子中锋递给你瓶水，他叫刘壮，高三，替补中锋，人缘极好。

更衣室里，你听到了不少内部消息：老周今年背负着市联赛前四的硬指标；主力控卫毕业走了，一号位现在是真空；还有个叫张扬的高二后卫，试训必进大名单，据说家里给球队拉了赞助……

试训结束前，刘壮拍拍你肩膀："明天分组对抗，别怵。球场上见真章，场下这些才只是开始。"`,
    patch: { attributes: { basketball_iq: 2 }, reputation: 1 },
    relationships: [
      { name: '刘壮', relationship: '队友/学长', status: '对你有好感', trust: 10 }
    ],
    choices: [
      '明天对抗赛全力冲击真空的一号位',
      '低调观察，先摸清每个对手的底细',
      '赛前去和张扬套近乎，探探虚实'
    ],
    next: ['auto', 'auto', 'auto']
  },

  defense_blood: {
    narrative: `你像块狗皮膏药一样贴上了对方核心。他加速，你跟；他变向，你扑。第三次对抗时两人撞在一起，你飞出边线，肩膀擦出血痕。

球馆安静了一瞬。

对方核心把你拉起来，眼神复杂："高一的，够狠。"

老周面无表情地在战术板上划了一笔。但训练结束后，助教小李塞给你一张创可贴："教练说，血性这东西，教不会。"

当晚你的肩膀肿了一块，翻个身都疼。但闭上眼，你嘴角是翘着的。`,
    patch: { attributes: { defense: 4, strength: 1 }, energy: -25, reputation: 3 },
    choices: ['冰敷休息，养精蓄锐', '轻伤不下火线，晚上加练核心', '去找老周主动请缨明天打对抗']
  , next: ['auto', 'auto', 'auto'] },

  defense_smart: {
    narrative: `你收着劲，眼睛死死盯住持球人的腰——教练说过，肩膀会骗人，腰不会。

第三次防守，他一个 crossover 起步，你提前半步滑到突破路线上，干净地切掉了球。快攻上篮，打进。

"有点意思。"老周嘟囔了一句，在战术板上写了什么。

旁边的学长低声惊呼："那可是市联赛场均18分的家伙！"

你什么都没说，只是回防的脚步更快了。会用脑子的防守，比蛮力更稀缺。`,
    patch: { attributes: { defense: 3, basketball_iq: 2, speed: 1 }, energy: -15, reputation: 2 },
    choices: ['乘胜追击，进攻端也要表现', '稳住心态，继续专注防守', '观察教练反应，见好就收']
  , next: ['auto', 'auto', 'auto'] },

  defense_lead: {
    narrative: `"换防！45度补位！"你的喊声穿透了整个半场。

起初没人听一个高一新人的。但两次成功的协防夹击之后，二队的防线开始跟着你的声音移动。对手的进攻一次次撞在网上。

暂停时，老周盯着你看了很久："谁让你指挥的？"

"没人让，"你擦了把汗，"场上总得有人说话。"

老周没接话，转身走了。但助教小李朝你比了个大拇指——他后来偷偷告诉你，教练最欣赏的就是这种"场上嗓门"。`,
    patch: { attributes: { basketball_iq: 3, defense: 2 }, energy: -15, reputation: 3 },
    choices: ['继续用声音领导，争取队长信任', '把功劳分给队友，处好关系', '专心打磨自己，少说话多做事']
  , next: ['auto', 'auto', 'auto'] }
};

// ---- 通用节点（兜底：自由输入/剧情树尽头）----
const GENERIC_TEMPLATES = [
  { tone: '成功', attr: 2, rep: 1, energy: -15,
    text: `你决定{ACTION}。

汗水砸在地板上的声音里，你感觉自己的节奏一点点找回来了。训练结束后的加练、录像室里的复盘、还有队友递过来的那瓶水——所有细节都在告诉你：这条路，走对了。

老周在名单上圈了什么。你的位置，暂时稳了。`,
    choices: ['加练一小时，巩固今天的收获', '早点休息，明天再战', '约队友聊聊，增进感情'] },
  { tone: '受挫', attr: 1, rep: 0, energy: -25,
    text: `你尝试{ACTION}。

但事情没那么顺利。连续第三次失误之后，你听见了看台上零星的笑声。老周的哨声尖锐地响起："重来！"

晚上躺在宿舍床上，天花板白得刺眼。膝盖上是新添的淤青。你想起了自己为什么站在这里——不是为了让谁满意，是因为那个球场上的梦，还烫着胸口。

明天，再来。`,
    choices: ['找教练请教问题出在哪', '看录像复盘到深夜', '睡一觉，用状态说话'] },
  { tone: '平淡', attr: 1, rep: 0, energy: -12,
    text: `你选择了{ACTION}。

日复一日的训练像潮水，把你往前推，也磨掉一些锋芒。今天的收获说不上多大，但肌肉记住了新的发力方式，脚步比昨天更扎实了半寸。

球馆的灯一盏盏熄灭。你投出的最后一球在网窝里转了两圈，落进。

十五人的大名单，还有两个名额空着。`,
    choices: ['保持节奏，稳步提升', '冒险尝试新技术动作', '约陈皓宇单挑，检验成果'] }
];

BBL.game.genericNode = function(action) {
  const t = GENERIC_TEMPLATES[Math.floor(Math.random() * GENERIC_TEMPLATES.length)];
  const attrs = {};
  const keys = Object.keys(BBL.getDefaultState().attributes);
  attrs[keys[Math.floor(Math.random() * keys.length)]] = t.attr;

  return {
    narrative: t.text.replace(/\{ACTION\}/g, action),
    patch: { attributes: attrs, energy: t.energy, reputation: t.rep },
    choices: t.choices.slice(),
    next: ['auto', 'auto', 'auto']
  };
};

// ---- 获取节点 ----
BBL.game.getNode = function(id, action) {
  if (id === 'auto' || !BBL.game.nodes[id]) {
    return BBL.game.genericNode(action || '继续训练');
  }
  return BBL.game.nodes[id];
};

// ---- 试玩模式开局 ----
BBL.game.trialIntro = function(profile) {
  const node = JSON.parse(JSON.stringify(BBL.game.nodes.start));
  node.narrative = node.narrative.replace('明诚中学', profile.school || '明诚中学');
  return node;
};
