# AGENTS.md — 篮球人生 (Basketball Life)

## 当前状态

- **工作目录**: `E:\opencode\BBL_new_GLM5.3`
- **平台**: Windows（开发用 Git Bash / PowerShell 均可）
- **项目状态**: 独立 Web 版已实现并通过浏览器实测（试玩模式全流程、API 冒烟、世界书编辑器）；APK 版兼容层已就绪（Capacitor + native.js 本地 API），经 GitHub Actions 打包
- **APK 版**: `public/` 由 Capacitor 包裹为 Android WebView 应用；`npm run cap:sync` 同步资产后用 `npm run cap:build`（本地）或 GitHub Actions（`.github/workflows/android.yml`，推送即构建）出 debug APK

---

## 项目概览

**篮球人生** 是一款 LLM 驱动的文字篮球人生游戏。玩家扮演篮球运动员，从高中 / CBA / NBA 开始职业生涯。叙事、比赛、训练、人际互动由大语言模型通过流式 SSE 生成；未配置 API Key 时自动降级为试玩模式（内置剧情树 + 通用节点兜底）。

### APK 版原理（Web 版零改动）

`public/js/native.js` 仅在 Capacitor 环境（`window.Capacitor` 存在）激活：拦截 `window.fetch`，把全部 `/api/*` 请求在客户端本地实现——存档/快照/配置/提示词 → localStorage；默认提示词/世界书 → `tools/sync-native.js` 复制进 `public/` 的静态副本；LLM → CapacitorHttp 原生请求（绕过 WebView CORS）；流式 → 全文取回后本地模拟 SSE 分片（打字机体验保留）。Web 版（有 Express）不经过此层任何逻辑。

**单一事实源约定**：`prompts-default.json`（根目录）为默认提示词唯一来源，server.js 启动时读取，APK 资产由 `npm run cap:sync` 复制同步（单测校验两份一致防漂移）；世界书同理（`worldbook/` → `public/worldbook/`）。

**APK 验证方式**（无模拟器/真机时）：`npm run mock` + `node test/cap-sim-server.js` 起模拟环境（静态托管 public/ + 注入 `window.Capacitor` 桩 + `/llm-proxy` 模拟原生网络），浏览器开 `http://127.0.0.1:3300` 即为 APK 同款代码路径；`npm run test:native` 对 native.js 本地 API 做 20 项确定性验证（配置/资产/LLM 非流式/模拟 SSE/存档快照/白名单）。APK 产物：`dist/篮球人生-debug.apk`（Actions 构建后下载），仓库 `Homer0519/bbl-basketball-life`（public，推送自动重建）。详见 `APK-BUILD.md`。

---

## 开发命令

| 命令 | 说明 |
|---|---|
| `start.bat`（双击）/ `./start.sh` | 一键启动：自动装依赖、开浏览器（推荐普通用户使用） |
| `npm install` | 安装依赖（仅 express） |
| `npm start` | 启动游戏服务器（端口 3000） |
| `npm run dev` | watch 模式（`node --watch`） |
| `npm test` | 单元测试（55 项：协议解析/脏输入容错/合并钳制/剧情树/记忆/世界书/APK 资产同步） |
| `npm run test:api` | API 黑盒边界测试（20 项；需先起 mock 和游戏服；结束自动恢复 config 并清理快照） |
| `npm run test:native` | APK 原生层验证（20 项；需先起 mock 和 `node test/cap-sim-server.js`） |
| `npm run mock` | 启动 mock LLM 服务（端口 3001，OpenAI 兼容含流式 SSE；`MOCK_DIRTY` 可产脏输出） |
| 浏览器打开 `http://localhost:3000` | 进入游戏 |
| `node --check server.js` | 语法检查 |

**无 key 测 LLM 链路**：先 `npm run mock`，再把 `config.json` 的 `base_url` 设为 `http://localhost:3001/v1`、`api_key` 设为 `sk-mock-test-key`（可用环境变量 `MOCK_API_KEY` 覆盖），启动游戏即可走完整的 `_ll`/`_ls`/`##STATE##` 管线。mock 会按游戏协议返回"开局叙事 + 完整绝对值 ##STATE## + ---CHOICES---"，回合时从 prompt 解析当前状态并叠加随机变化后输出。

无测试框架、无构建步骤：前端为原生 HTML/CSS/JS，改完静态文件刷新即生效（Express 按请求提供）；改 `server.js` 需重启。

---

## 项目结构

```
BBL_new_GLM5.3/
├── server.js              # Express：API、LLM 代理、提示词、世界书读写
├── start.bat / start.sh   # 一键启动（自动装依赖、开浏览器）
├── config.json            # LLM 配置（api_key / base_url / model / server；默认只绑 127.0.0.1）
├── prompts.json           # 用户自定义提示词覆盖（system_prompt / unrestricted_prompt）
├── package.json
├── data/                  # 服务端存档 save_{slot}.json 与 snapshots/
├── test/                  # 测试与开发工具
│   ├── run-tests.js       # 单元测试（52 项：协议/脏输入容错/剧情树/记忆/世界书）
│   ├── api-tests.js       # API 黑盒边界测试（20 项；自动恢复 config、清理快照）
│   └── mock-llm.js        # mock LLM（MOCK_DIRTY=fence|noend|delta|str|choicetext 模拟脏输出）
├── worldbook/             # 世界书（JSON，可在设置页编辑）
│   ├── cba.json           # CBA 20 队（数据核实至 2025-26 赛季 + 2026 夏窗）
│   └── nba.json           # NBA 30 队（2025-26 赛季 + 2026 夏窗）
├── gui-test-screenshots/  # 浏览器实测截图（测试证据）
└── public/
    ├── index.html         # 单页 UI（标题/创建/游戏/模态框）
    ├── css/style.css      # 毛玻璃主题（暗底+紫/青渐变）
    └── js/
        ├── app.js         # 主控制器（流程、回合、turnToken 防竞态、存档、快照、设置）
        ├── state.js       # ##STATE## 协议 + 存档 + 快照封装（含类型钳制/XSS 防御）
        ├── game.js        # 试玩模式剧情树 + 通用节点
        ├── llm.js         # _ll（非流式）/ _ls（SSE 流式）客户端
        ├── memory.js      # narrativeHistory / memoryLog 记忆管理
        ├── worldbook.js   # 世界书按阶段/关键词选择性注入（_pickOwnTeam 最长关键词去歧义）
        └── ui.js          # 屏幕切换、打字机、选项、侧栏、模态框、toast（全量转义）
```

所有前端文件挂在 `window.BBL` 命名空间下，加载顺序：state → memory → worldbook → llm → ui → game → app。

---

## 核心架构与约定

### LLM 通信（OpenAI 兼容）

| 用途 | 调用约定 | 说明 |
|---|---|---|
| 开局生成（非流式） | `_ll` | `POST /api/llm/non-stream`，一次性返回 |
| 动作生成（流式） | `_ls` | `POST /api/llm/stream`，SSE `data: {json}\n\n` 逐段推送 delta |
| 上游接口 | `{base_url}/chat/completions` | 服务端代理转发，前端不接触 api_key |

### 状态序列化协议

LLM 叙事文本末尾嵌入：

```
##STATE##
{ ...player/attributes/season/relationships/reputation/story_stage/money/energy... }
##ENDSTATE##
---CHOICES---
1. 选项一
2. 选项二
```

`state.js` 负责：提取（容错无 ENDSTATE、剥离 ```json 围栏）、关系字段归一化（type/level/notes → relationship/trust）、合并（浅合并+stats 深合并、attributes 钳 0-99、energy 钳 0-100）、选项提取（多分隔符兼容+数字行回退）、叙事清洗。

### 提示词组装顺序

基础 system_prompt（默认内置，可被 prompts.json 覆盖）→（用户自填的）`unrestricted_prompt` 追加在末尾。`unrestricted_prompt` 默认为空，由用户在设置页自行填写并承担责任。模板（game_intro / game_action）占位符：`{name} {position} {height} {weight} {stage} {background} {state} {memory} {worldbook} {action}`。

### 世界书

- `worldbook/*.json`：条目含 `stages`（story_stage 前缀匹配）与 `keywords`
- 注入规则：舞台命中 → 联赛概况；玩家所属球队 → 完整名单；叙事提及的其他队 → 简要名单（最多 3 支）
- 创建角色时按舞台动态填充球队下拉（CBA 20 队 / NBA 30 队）
- 数据快照：2025-26 赛季完赛 + 2026 夏窗（上海夺冠 4:1 广厦、尼克斯总冠军、字母哥赴热火、杰伦·布朗赴 76 人、张镇麟转会上海等），可经设置页编辑

### 存档机制

| 位置 | 格式 |
|---|---|
| 服务端 `data/save_{slot}.json` | `{ meta, game_state }`，双写主渠道 |
| 浏览器 `localStorage` key: `bbl_save_{slot}` | 兜底 |

`auto` 为自动存档槽（每回合自动写入）。

### 快照系统（ts / rs）

每回合行动前自动 `POST /api/snapshot`（ts，保留最近 50 个）；"重生成"按钮恢复上一快照（rs）并重新生成本回合；快照弹窗可恢复任意历史快照。

---

## 核心 API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/config` | GET/POST | LLM 配置（GET 回传脱敏 key） |
| `/api/llm/non-stream` | POST | `_ll` 非流式 |
| `/api/llm/stream` | POST | `_ls` 流式 SSE |
| `/api/save`、`/api/load/:slot`、`/api/saves`、`/api/save/delete` | POST/GET | 存档 |
| `/api/snapshot`、`/api/snapshot/restore`、`/api/snapshots` | POST/GET | 快照 ts/rs |
| `/api/prompts/default`、`/api/prompts/custom`、`/api/prompts/system` | GET/POST | 提示词 |
| `/api/worldbook`、`/api/worldbook/delete` | GET/POST | 世界书读写（name 白名单 `[a-zA-Z0-9_-]+`） |

---

## 已知注意事项

- 浏览器后台标签页会节流 `setTimeout`，打字机效果在非前台标签中变慢（前台正常）
- `_ls` 流式渲染在检测到 `##STATE##` / `---CHOICES---` / ``` 围栏后停止向叙事区输出协议内容（跨分片标记有缓冲处理）；客户端断开时服务端会中止上游 LLM 流
- **LLM 必须输出"绝对值"完整状态**：`mergeState` 按绝对值合并，若模型输出增量（如 `energy: -15`）会直接覆盖原值（负数会被钳到 0）。系统提示词与 game_action 模板已明确要求输出完整状态
- **XSS 防御**：`mergeState` 对 player/season/stats/nextGame 数值字段强制 `Number()`（非法回退原值），`renderSidebar` 全量转义；叙事/选项走 `textContent`。LLM 输出 HTML 片段不会执行
- **extractChoices 容错**：强分隔符 `---CHOICES---` 优先；弱分隔符（"选项："）仅独占一行时可信（避免叙事正文"选择："误切）；STATE 块先行剔除（闭合于 ENDSTATE 或围栏）
- 服务器默认只绑 `127.0.0.1`；需局域网访问时在 config.json 显式设置 `server.host`
- LLM 未配置或调用失败时：开局自动降级试玩模式；回合失败提示可用"重生成"重试；空响应显示错误提示不落地状态
- 服务端 LLM 调用带超时（非流式 120s / 流式 180s），防止上游挂起永久阻塞
- 设置页保存 LLM 配置时回传掩码（含 `****`）不会覆盖真实 key（server 端过滤）
- 存档命名使用自定义弹窗（`window.prompt` 在内嵌浏览器/WebView 中会被静默拒绝）
- 试玩模式剧情分支依赖选项序号映射 `node.next[]`（`app.js trialTurn`）；"重生成"会带原选项序号重放
- **回合令牌防竞态**（`app.js BBL.app.turnToken`）：开局/读档/快照恢复/退出/新回合都会自增令牌；打字机或流式生成完成时的回调若发现令牌不匹配则丢弃，防止"生成中途被打断后旧状态污染新游戏"。`trialTurn` 被 `await`，busy 覆盖整个输出期
- `test/mock-llm.js` 是开发用 mock；游戏服务器配置指向 `http://localhost:3001/v1`、key `sk-mock-test-key` 即用；`MOCK_DIRTY` 环境变量可让 mock 产出畸形输出（fence/noend/delta/str/choicetext）用于容错测试
