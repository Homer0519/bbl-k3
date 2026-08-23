# APK 打包交接说明（篮球人生）

## 状态速览

- 代码已推送到 **私有仓库 `Homer0519/bbl-basketball-life`**（main 分支）
- GitHub Actions workflow：`.github/workflows/android.yml`（推送即自动构建 debug APK，产物名 `basketball-life-apk`）
- 本机直连 `github.com` 不稳定，**走本地代理 `127.0.0.1:10808`（HTTP）可用**
- 授权令牌在 `.gh-token.json`（已 gitignore，未入库；**用完建议到 github.com/settings/applications 撤销 GitHub CLI 的授权**）

## 如果需要重新触发构建

### 方式 A：网页（最简单）
打开仓库 → Actions 标签 → `Android APK Build` → `Run workflow` → 跑完后在该次运行页面底部 `Artifacts` 区下载 `basketball-life-apk`（zip 内为 `篮球人生-debug.apk`）。

### 方式 B：命令行（挂代理）
```bash
cd /e/opencode/BBL_new_GLM5.3
git add -A && git commit -m "变更说明"
git -c http.proxy=http://127.0.0.1:10808 push origin main   # 推送即自动构建
```
若 git 未记住 token，remote 已内嵌令牌；令牌失效时重新授权或用 SSH。

### 方式 C：本地打包（不依赖 GitHub）
需要 Android SDK + Java 21，然后：
```bash
npm install
npm run cap:sync    # 同步前端资产+世界书+提示词到 android 工程
npm run cap:build   # gradlew assembleDebug，产物在 android/app/build/outputs/apk/debug/
```

## 仓库内容要点

| 路径 | 作用 |
|---|---|
| `public/` | 前端（Web 与 APK 共用；Capacitor webDir） |
| `public/js/native.js` | **APK 专属层**：检测 Capacitor 环境后拦截 `/api/*` fetch，本地实现存档/快照（localStorage）、LLM（CapacitorHttp，绕 CORS，流式为本地模拟分片）。Web 版完全不经过它 |
| `android/` | Capacitor Android 工程（改图标/包名在这里） |
| `prompts-default.json` | 默认提示词单一事实源（server.js 与 APK 共用） |
| `worldbook/` | 世界书源（`npm run cap:sync` 会复制到 `public/worldbook/`） |
| `tools/sync-native.js` | 同步打包资产 + 一致性校验（单测会跑） |
| `.github/workflows/android.yml` | CI：npm ci → cap:sync → gradle assembleDebug → 上传 APK 产物 |

## 改动前端后重新出 APK

```bash
npm run cap:sync
git add -A && git commit -m "update" 
git -c http.proxy=http://127.0.0.1:10808 push origin main
# 等 Actions 跑完 → 网页下载 Artifacts
```

## 已知注意

- APK 里存档/快照/配置都存在应用 localStorage（卸载即清空）
- APK 的 LLM 配置在应用内"设置"页填写，与 Web 版互不相通
- debug APK 未签名上架用途；如需正式发布要生成 release keystore 签名
