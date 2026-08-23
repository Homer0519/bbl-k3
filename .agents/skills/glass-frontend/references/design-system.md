# 毛玻璃设计系统（Glassmorphism）

本项目验证过的完整视觉配方：暗夜底 + 紫青极光 + 半透明玻璃卡片。目标是"简洁、轻盈、有层次"，避免重色块和粗边框。

## 1. 设计令牌（:root 变量）

```css
:root {
  --bg: #0b0d14;                              /* 暗夜底色 */
  --glass: rgba(255,255,255,0.055);           /* 卡片玻璃底 */
  --glass-strong: rgba(255,255,255,0.095);    /* 悬停/激活态 */
  --glass-soft: rgba(255,255,255,0.03);       /* 输入框/嵌套区 */
  --border: rgba(255,255,255,0.11);           /* 常规边框 */
  --border-strong: rgba(255,255,255,0.18);    /* 悬停边框 */
  --text: #eef0f6;
  --muted: #9aa3b8;                           /* 次要文字 */
  --accent: #8b7cf8;                          /* 紫罗兰主色 */
  --accent-bright: #a597ff;
  --teal: #5eead4;                            /* 青碧辅色 */
  --grad: linear-gradient(135deg, #8b7cf8 0%, #5eead4 100%);
  --err: #fb7185; --ok: #4ade80; --warn: #fcd34d;
  --radius: 18px; --radius-sm: 12px;
  --blur: blur(22px) saturate(150%);
  --shadow: 0 8px 32px rgba(0,0,0,0.35);
}
```

## 2. 极光背景（氛围层）

放在 `#app::before`（`position: fixed; inset: 0; pointer-events: none`），用 3-5 团柔和 radial-gradient，透明度控制在 0.07-0.22：

```css
#app::before {
  background:
    radial-gradient(42vw 42vw at 12% 8%, rgba(139,124,248,0.22), transparent 65%),
    radial-gradient(46vw 46vw at 88% 88%, rgba(94,234,212,0.14), transparent 65%),
    radial-gradient(36vw 36vw at 82% 12%, rgba(251,113,133,0.07), transparent 60%);
}
```

换肤配方：底色 `--bg` + 2-3 个极光色即可整体变调（如暖橙金：底 #140f0a，极光 #f59e0b/#fb923c/#f43f5e）。

## 3. 玻璃卡片（万能组件类）

```css
.glass, .panel, .narrative-block, .game-header, #action-bar, .modal {
  background: var(--glass);
  backdrop-filter: var(--blur);
  -webkit-backdrop-filter: var(--blur);       /* Safari 必带 */
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}
```

卡片强调线（叙事块左侧的细渐变竖线）：

```css
.narrative-block::before {
  content: ""; position: absolute; left: 0; top: 18px; bottom: 18px;
  width: 3px; border-radius: 3px; background: var(--grad);
}
```

## 4. 胶囊按钮

```css
.btn {
  border: 1px solid var(--border);
  background: var(--glass);
  border-radius: 999px;                       /* 全圆角 = 胶囊 */
  padding: 9px 18px;
  transition: all 0.18s ease;
}
.btn:hover { border-color: var(--border-strong); background: var(--glass-strong); transform: translateY(-1px); }
.btn.primary {
  background: var(--grad); border: none; color: #0b0d14; font-weight: 700;
  box-shadow: 0 4px 18px rgba(139,124,248,0.35);
}
```

## 5. 渐变文字（标题/数据强调）

```css
.title-name, .stat-line, .game-brand, .modal-head h3 {
  background: var(--grad);
  -webkit-background-clip: text; background-clip: text;
  color: transparent;
}
```

注意：渐变文字元素上不要同时设置 `color`，且需要 fallback（老浏览器会显示透明——可加 `@supports not (background-clip: text) { color: var(--accent); }`）。

## 6. 数据可视化小件

**属性条**（统一渐变填充，不做按值变色——视觉更简洁）：

```css
.attr-track { height: 5px; border-radius: 3px; background: rgba(255,255,255,0.07); }
.attr-fill  { height: 100%; border-radius: 3px; background: var(--grad);
              box-shadow: 0 0 8px rgba(139,124,248,0.4); transition: width 0.6s ease; }
```

**状态胶囊**（阶段标签等）：

```css
.player-sub.stage {
  display: inline-block; padding: 2px 10px; border-radius: 999px;
  background: rgba(94,234,212,0.1); border: 1px solid rgba(94,234,212,0.25);
}
```

**分段控制器**（设置页标签）：

```css
.tabs { display: flex; gap: 6px; padding: 4px; background: var(--glass-soft);
        border: 1px solid var(--border); border-radius: 999px; }
.tab-btn.active { background: var(--glass-strong); box-shadow: inset 0 0 0 1px var(--border-strong); }
```

## 7. 模态框与 Toast

- 模态框底色比卡片更实（`rgba(20,24,38,0.72)`），overlay 再叠 `blur(6px)`，形成"两层玻璃"景深
- Toast 用主色发光边框 + 胶囊形，从底部上浮入场（`transform` + `opacity` 过渡 0.3s）

## 8. 输入控件

```css
input, select, textarea {
  background: var(--glass-soft); border: 1px solid var(--border);
  border-radius: var(--radius-sm); color: var(--text);
}
input:focus { border-color: rgba(139,124,248,0.6); background: var(--glass); }
select option { background: #141826; }         /* 否则下拉是白底刺眼 */
```

## 9. 动效纪律

- 入场：`@keyframes rise { from { opacity:0; transform:translateY(10px);} }` 0.3-0.45s
- 悬停：`translateY(-1px)` + 边框/发光增强，0.18s
- 图标漂浮（标题 logo）：`@keyframes float` 3s 循环
- 一个界面动效种类 ≤3 种；过渡时长统一（0.18s 交互 / 0.3s 入场 / 0.6s 数据条）

## 10. 响应式

断点 860px：游戏布局单列化（侧栏 order:2）、表单单列、标题字号与字距收缩。移动端 `#narrative-area` 限高 `48vh`。
