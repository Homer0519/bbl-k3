# 浏览器 GUI 实测手册（IAB 环境）

本项目实测沉淀的操作流程与陷阱对策。核心纪律：**每个测试点必须有截图证据才能下结论**。

## 0. 环境

- 测试工具：`mcp__node_repl__js`（Browser Use）
- **每次 js 调用都是全新内核**：变量/import/标签页绑定不保留，每次调用开头必须重新 bootstrap：

```js
const browserPluginRoot = process.env.ZCODE_PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;
const { join } = await import("node:path");
const { pathToFileURL } = await import("node:url");
const { setupBrowserRuntime } = await import(
  pathToFileURL(join(browserPluginRoot, "scripts", "browser-client.mjs")).href
);
await setupBrowserRuntime({ globals: globalThis });
const browser = await agent.browsers.getForUrl("http://localhost:3000/");
```

## 1. 标签页生命周期协议

- 开新页：`const tab = await browser.tabs.new(); await tab.goto(url); await tab.playwright.waitForLoadState({ state: "domcontentloaded" });`
- 每个新的操作批次：先 `browser.tabs.list()` 检查，再按 id 绑定 `browser.tabs.get(id)`（绝不按数组位置猜）
- 结束时显式 `tab.close()`；`finalize` 只用于标记交付，不关闭

## 2. 读取页面（优先级）

1. `tab.playwright.domSnapshot()` — AI/ARIA 树，默认观察手段
2. `tab.dom_cua.get_visible_dom()` — 需要元素 ref/rect/selector 时用（交互定位的基础）
3. 截图 — 视觉判断（布局/样式/重叠）时用

## 3. 交互（关键：click 的正确姿势）

**playwright click/fill 在 IAB 中经常超时失灵**（元素可见可定位但事件不送达）。稳定方案：

```js
const dom = await tab.dom_cua.get_visible_dom();
const btn = dom.elements.find(e => e.selector === "#btn-new");
await tab.dom_cua.click({ node_id: btn.ref });
```

- 文本输入：`dom_cua.click` 聚焦 input → `dom_cua.type({ text })`
- 下拉选择：`playwright.selectOption({ label })` 可用
- 备选坐标点击：`tab.cua.click({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 })`
- **若 dom_cua/cua/playwright 三种点击全部无效**：页面 JS 与渲染正常但输入管道失灵（IAB 偶发故障），关标签页重开；重开仍无效则放弃浏览器验证，改用代码审查 + 自动化测试兜底，并如实向用户说明

## 4. 截图取证

```js
const fs = await import("node:fs");
const bytes = await tab.screenshot();
fs.mkdirSync("gui-test-screenshots", { recursive: true });
fs.writeFileSync("gui-test-screenshots/t{n}_{场景}.png", bytes);
await nodeRepl.emitImage(bytes);   // 必须同 cell 内 emit
```

- 命名：`t{序号}_{场景}.png`（t1_title / t2_game_intro / t3_worldbook_modal）
- **截图后必须 Read 读图目视确认**（或 emitImage 直接看）：检查布局、文字重叠、截断、对比度
- 截图与本页技巧中提到的 `evaluate` 读取冲突时以截图为准（evaluate 在 VM 语义下有假象——本项目曾把正常 JSON 误读为 "[object Object]"）

## 5. 等待策略

- 页面加载：`waitForLoadState("domcontentloaded")`（不要用 networkidle，IAB 不支持）
- 出现特定 UI：`locator.waitFor({ state: "visible" })`
- **打字机/动画：后台标签页 setTimeout 被浏览器节流**，1000 字叙事可能需要 100s+ 才打完。方案：`waitForTimeout(100000)` 分段等（单次上限 120000ms）；等待后用 domSnapshot 确认选项区已渲染
- 判定"还在打字"：叙事区块文字在增长但选项按钮未出现

## 6. 测试流程模板

1. 语法检查（node --check × 全部改动文件）
2. 起服务器（后台）+ curl 冒烟核心 API
3. 浏览器走用户路径：每步 = 交互 → domSnapshot 确认状态变化 → 关键节点截图
4. 表单类：填入 → 提交 → 验证服务端副作用（curl 查数据）
5. 弹窗类：`tab.getJsDialog()` 检查原生对话框；自定义模态框用 domSnapshot 确认
6. 错误路径：杀掉依赖服务，验证降级提示与 UI 不崩

## 7. 测试与修码分离

- 发现 bug：记录（现象+复现步骤+截图），继续测其余路径，**不要边测边修**
- 测试结束后统一修复 → 刷新页面（静态文件即时生效）→ 复验受影响路径
- 修复涉及逻辑时重跑自动化测试（单元/API）确认无回归

## 8. 证据汇总格式

最终报告逐点列出：通过项（附截图路径）、失败项（附复现步骤+截图）、无法执行项（说明阻塞原因）。凡无截图的结论标注"未目视验证"。
