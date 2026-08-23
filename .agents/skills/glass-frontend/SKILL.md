---
name: glass-frontend
description: 构建无构建步骤的原生 HTML/CSS/JS 单页应用（毛玻璃玻璃拟态设计系统 + 浏览器 GUI 实测验证工作流）。Use whenever 用户要求制作/修改前端页面、新建 Web 界面、统一视觉风格、或需要浏览器实测前端功能——即使只说"做个页面"或"界面好丑要改"。
---

# Glass Frontend — 原生单页应用 + 毛玻璃设计 + GUI 实测

一套经过完整项目验证的前端制作流程：原生技术栈（零构建、刷新即生效）、统一的毛玻璃视觉语言、以及"必须浏览器实测 + 截图取证"的验证纪律。

## 何时遵循本 skill

- 从零制作单页应用（游戏、工具、仪表盘）
- 为现有原生前端新增页面/弹窗/组件，需保持风格一致
- 用户要求改视觉风格（"太丑了""要毛玻璃质感""换个配色"）
- 前端改完需要真实浏览器验证行为

不适用于：已使用 Vue/React/构建链的项目（另起炉灶成本更高）。

---

## 第一步：架构约定（动手前先定）

```
public/
├── index.html         # 单页 UI：多个 .screen 区块 + 模态框 + toast
├── css/style.css      # 唯一样式文件（设计系统见 references/design-system.md）
└── js/                # 全部挂 window.BBL 命名空间（或项目专属命名空间）
    ├── state.js       # 状态与数据协议（纯逻辑，不碰 DOM）
    ├── memory.js      # 派生数据管理
    ├── ui.js          # DOM 渲染：屏幕切换、打字机、模态框、toast
    ├── game.js        # 业务逻辑（无 LLM 时的兜底）
    ├── llm.js         # 网络客户端（fetch/SSE）
    └── app.js         # 主控制器：流程编排、事件绑定（最后加载）
```

铁律：

1. **script 标签按依赖顺序排列**，app.js 最后。每个文件首行 `window.X = window.X || {}`。
2. **纯逻辑与 DOM 分离**：state/memory 可在 Node 中 `eval` 单测（`global.window = global` 后加载即可跑）。
3. **改静态文件刷新即生效；改 server 需重启**——测试前先分清改的是哪边。
4. **XSS 防御只用一种方式**：动态文本一律 `element.textContent = x`；模板字符串拼 HTML 时用户数据必须过 `esc()` 转义函数。

## 第二步：HTML 骨架模式

```html
<div id="app">
  <section id="screen-title" class="screen active">…</section>
  <section id="screen-create" class="screen">…</section>
  <section id="screen-game" class="screen">
    <header class="game-header">…</header>
    <div class="game-layout"><main id="narrative-area">…</main><aside id="sidebar">…</aside></div>
    <footer id="action-bar">…</footer>
  </section>
</div>
<div id="modal-overlay" class="hidden">
  <div class="modal" id="modal-settings">…</div>
</div>
<div id="toast"></div>
```

- 屏幕切换 = `.screen.active` 的增删（CSS `display:flex` 控制）
- 模态框 = overlay 显隐 + `.modal.active`，点击 overlay 空白处关闭
- **禁止 `window.prompt/confirm/alert`**：内嵌浏览器/WebView 会静默拒绝。一律用自定义模态框（本项目实测踩坑）

## 第三步：设计系统

读 `references/design-system.md` 获取完整 CSS 变量与组件样式（毛玻璃卡片、极光背景、胶囊按钮、渐变文字、属性条）。核心配方：

```css
:root {
  --glass: rgba(255,255,255,0.055);       /* 卡片底 */
  --border: rgba(255,255,255,0.11);       /* 细边框 */
  --grad: linear-gradient(135deg,#8b7cf8,#5eead4);  /* 主渐变 */
  --blur: blur(22px) saturate(150%);
}
.glass { background: var(--glass); backdrop-filter: var(--blur);
         border: 1px solid var(--border); border-radius: 18px; }
```

换肤 = 只改 `:root` 变量与极光 `radial-gradient` 位置色值，组件样式不动。

## 第四步：浏览器 GUI 实测（必做，不能只 curl）

改完前端必须真实浏览器走一遍关键路径。完整操作手册见 `references/browser-testing.md`，速记：

1. `node --check` 所有改动的 js；JSON 文件用 `node -e "JSON.parse(...)"` 校验
2. 起服务器，浏览器打开，`domSnapshot()` 确认结构
3. **交互用 `dom_cua.click({node_id})`**（从 `get_visible_dom()` 取 ref）——playwright click/fill 在 IAB 中经常超时失灵
4. **每个关键界面截图**存入 `gui-test-screenshots/t{n}_{场景}.png`，用 Read 读图目视确认（布局/重叠/截断/对比度）
5. 动画/打字机效果在后台标签页被节流——等待时间给足（打字机全程可能需要 100s+），或提示用户前台验证

## 第五步：异步时序防护（有生成/动画类异步时）

- 生命周期事件（开局/读档/恢复/退出/新回合）自增 `turnToken`
- 异步完成回调先比对令牌，不匹配直接 return
- 打字机回合用 `await` 包住，busy 覆盖整个输出期（否则提前解锁导致旧回调污染新状态）

## 测试台账纪律

每个测试点必须有截图证据才结论"通过"。发现 bug：先记录、继续测其余路径、测试结束后统一修复并复验（测试与修码分离）。修复后重跑相关自动化测试（`npm test` / `npm run test:api`）确认无回归。

## 陷阱清单（本项目实测验证过）

| 陷阱 | 对策 |
|---|---|
| `window.prompt` 静默拒绝 | 自定义模态框 |
| playwright click 超时 | `dom_cua.click({node_id})`；仍失灵则关标签页重开 |
| 后台标签 setTimeout 节流 | 长等待；文档注明前台正常 |
| 新 js 内核不共享变量 | 每次调用重新 bootstrap + `tabs.list()` 重绑标签页 |
| 中文输入法 Enter 触发提交 | `e.key==='Enter' && !e.isComposing` |
| API key 掩码回传覆盖真值 | 服务端过滤含 `****` 的回传 |
