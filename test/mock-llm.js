// ============================================================
// Mock LLM 服务 — OpenAI 兼容接口（用于无真实 key 时测试游戏完整链路）
// 用法: node test/mock-llm.js  （监听 http://127.0.0.1:3001）
// 然后把游戏 config.json 的 base_url 指到 http://localhost:3001/v1
// ============================================================

const http = require('http');

const PORT = 3001;

// ---- 从 prompt 中提取信息 ----
function parsePrompt(prompt) {
  const get = (re) => {
    const m = prompt.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    name: get(/球员姓名：(.+)/) || '球员',
    position: get(/位置：(.+)/) || 'SF',
    height: parseInt(get(/身高：(\d+)/) || '188'),
    weight: parseInt(get(/体重：(\d+)/) || '80'),
    stage: get(/起始舞台：(.+)/) || 'high_school',
    action: get(/球员选择了：(.+)/)
  };
}

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ---- 生成开局叙事（含 ##STATE## 与 ---CHOICES---）----
function buildIntro(p) {
  const narrative = `清晨六点，训练馆的灯刚亮，地板上还残留着昨夜水汽。${p.name}背着包推门进来，球鞋在门口磕了磕灰。

这是你在这个舞台的第一天。前台登记表上写着你的名字——${p.name}，${p.position}，${p.height}厘米。你把这三个信息看了三遍，像是要把它们刻进骨头里。

助教把一摞战术板摔在长凳上："新人先跟二队练！想上一队，拿表现说话！"

远处，几个老队员正在练三分。篮球划过空气的声音很脆。你知道，从今天起，每一个清晨都可能改变你的一生。`;

  const state = {
    player: { name: p.name, age: p.stage === 'high_school' ? 16 : (p.stage === 'cba' ? 19 : 22), position: p.position, height: p.height, weight: p.weight, charm: rnd(40, 60) },
    attributes: {
      speed: rnd(45, 55), shooting: rnd(45, 55), dribbling: rnd(45, 55),
      defense: rnd(45, 55), strength: rnd(45, 55), stamina: rnd(45, 55), basketball_iq: rnd(45, 55)
    },
    season: {
      year: 1, team: '', league: p.stage.toUpperCase(), games_played: 0,
      stats: { ppg: 0, apg: 0, rpg: 0, spg: 0, bpg: 0, fg_pct: 0 },
      nextGame: { opponent: '内部教学赛', daysUntil: 3, location: '主场', goal: '给教练组留下第一印象' }
    },
    relationships: [
      { name: '助教老李', relationship: '教练组', status: '严格但公正', trust: 5 }
    ],
    reputation: rnd(5, 12),
    story_stage: p.stage,
    money: 100,
    energy: 95
  };

  return narrative + `\n\n##STATE##\n${JSON.stringify(state, null, 2)}\n##ENDSTATE##\n\n---CHOICES---\n1. 主动加练一小时投篮，让教练组看到态度\n2. 去力量房练核心，弥补身体对抗短板\n3. 泡在录像室研究战术，用脑子打球`;
}

// ---- 生成回合叙事 ----
// 协议要求：输出「绝对值」完整状态。从 prompt 中解析当前 ##STATE##，
// 在其基础上叠加随机变化后原样输出（模拟真实 LLM 的行为）。
function buildAction(p, prompt) {
  const action = p.action || '加练';
  const quality = pick(['成功', '受挫', '平淡']);

  const narratives = {
    成功: `你选择了「${action}」。

汗水砸在地板上，节奏一点点回到身体里。助教老李在场边看了很久，最后只留下一句："明天早训，别迟到。"

——这句话在队里意味着什么，老队员们都清楚。你的位置，往前挪了一格。`,
    受挫: `你尝试「${action}」。

连续第三次失误之后，你听见了看台上零星的议论声。哨声响起："重来！"

深夜的宿舍，你盯着天花板复盘每一个细节。膝盖上的淤青在隐隐作痛，但心里的那团火烧得更旺了。`,
    平淡: `你选择了「${action}」。

日复一日的训练像潮水，把你往前推。今天的收获说不上惊人，但脚步比昨天更扎实了半寸，肌肉记住了新的发力方式。

球馆的灯一盏盏熄灭，你投出的最后一球在网窝里转了两圈，落进。`
  };

  // 解析当前状态；失败则退回默认结构
  let cur = {};
  const m = prompt.match(/##STATE##\n([\s\S]*?)\n##ENDSTATE##/);
  if (m) {
    try { cur = JSON.parse(m[1]); } catch { cur = {}; }
  }

  const state = JSON.parse(JSON.stringify(cur));
  state.attributes = state.attributes || {};
  state.player = state.player || {};
  state.season = state.season || {};
  state.season.stats = state.season.stats || {};
  state.season.nextGame = state.season.nextGame || {};
  state.relationships = Array.isArray(state.relationships) ? state.relationships : [];

  // 在当前值基础上叠加变化（绝对值输出）
  const attrKeys = ['speed', 'shooting', 'dribbling', 'defense', 'strength', 'stamina', 'basketball_iq'];
  for (const k of pick2(attrKeys)) {
    const base = typeof state.attributes[k] === 'number' ? state.attributes[k] : 50;
    const delta = quality === '成功' ? rnd(2, 4) : quality === '受挫' ? rnd(-1, 1) : rnd(0, 2);
    state.attributes[k] = Math.max(0, Math.min(99, base + delta));
  }

  const energyBase = typeof state.energy === 'number' ? state.energy : 100;
  state.energy = Math.max(0, Math.min(100, energyBase - rnd(8, 22)));

  const repBase = typeof state.reputation === 'number' ? state.reputation : 10;
  state.reputation = Math.max(0, repBase + (quality === '成功' ? rnd(1, 3) : 0));

  const moneyBase = typeof state.money === 'number' ? state.money : 50;
  state.money = moneyBase + rnd(-20, 50);

  const ng = state.season.nextGame;
  if (ng.daysUntil && ng.daysUntil > 1) ng.daysUntil -= 1;

  const rel = state.relationships.find(r => r.name === '助教老李');
  if (rel) rel.trust = (rel.trust || 0) + (quality === '成功' ? rnd(3, 8) : rnd(0, 2));
  else state.relationships.push({ name: '助教老李', relationship: '教练组', status: '持续观察你', trust: rnd(0, 5) });

  return narratives[quality] + `\n\n##STATE##\n${JSON.stringify(state, null, 2)}\n##ENDSTATE##\n\n---CHOICES---\n1. 趁热打铁，继续加练弱项\n2. 找助教复盘今天的得失\n3. 好好休息，明天状态说话\n4. 约队友单挑检验训练成果`;
}

// 随机取 n 个不重复元素
function pick2(arr, n = 2) {
  const copy = arr.slice();
  const out = [];
  while (out.length < n && copy.length) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

// ---- 构造响应内容 ----
function buildContent(body) {
  const prompt = body.messages?.map(m => m.content).join('\n') || '';
  const p = parsePrompt(prompt);
  let content;
  if (prompt.includes('生成开局') || prompt.includes('开局场景') || !p.action) {
    content = buildIntro(p);
  } else {
    content = buildAction(p, prompt);
  }
  return applyDirty(content);
}

// ---- 脏输出模拟（环境变量 MOCK_DIRTY 选择场景，默认干净输出）----
// 用于测试前端对畸形 LLM 输出的容错：fence=围栏包裹 / noend=缺ENDSTATE /
// delta=增量状态 / str=字符串型数值(XSS) / choicetext=叙事含"选择："字样
function applyDirty(content) {
  const dirty = process.env.MOCK_DIRTY || '';
  switch (dirty) {
    case 'fence':
      return content.replace('##STATE##\n', '##STATE##\n```json\n').replace('\n##ENDSTATE##', '\n```');
    case 'noend':
      return content.replace(/\n?##ENDSTATE##/, '');
    case 'delta':
      return content.replace(/##STATE##[\s\S]*?##ENDSTATE##/,
        '##STATE##\n{ "energy": -15, "attributes": { "shooting": 2 } }\n##ENDSTATE##');
    case 'str':
      return content
        .replace(/"height": \d+/, '"height": "<img src=x onerror=alert(1)>"')
        .replace(/"ppg": \d+/, '"ppg": "<script>alert(2)</script>"');
    case 'choicetext':
      return content.replace('---CHOICES---',
        '教练把你叫到办公室："关于未来，你需要做出选择：\n1. 留在青年队\n2. 申请转会"\n那天晚上你辗转反侧。\n---CHOICES---');
    default:
      return content;
  }
}

// ---- HTTP 服务 ----
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const content = buildContent(body);
    const auth = req.headers['authorization'] || '';
    const validKey = process.env.MOCK_API_KEY || 'sk-mock-test-key';
    if (auth !== `Bearer ${validKey}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
      return;
    }

    if (!body.stream) {
      // 非流式：一次性返回
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion',
        model: body.model || 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 500, total_tokens: 600 }
      }));
      return;
    }

    // 流式：SSE 分片推送
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const CHUNK = 24;   // 每片字符数
    const DELAY = 12;   // 片间延迟 ms
    let i = 0;
    const timer = setInterval(() => {
      if (i >= content.length) {
        clearInterval(timer);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }
      const piece = content.slice(i, i + CHUNK);
      i += CHUNK;
      res.write(`data: ${JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }]
      })}\n\n`);
    }, DELAY);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock LLM (OpenAI 兼容) 运行于 http://127.0.0.1:${PORT}`);
  console.log('游戏 config.json 设置: base_url = http://localhost:3001/v1, api_key = 任意非空值');
});
