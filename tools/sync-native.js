// ============================================================
// 同步打包资产：把服务端数据源复制进 public/（APK 的 webDir）
//   prompts-default.json → public/prompts-default.json
//   worldbook/*.json     → public/worldbook/*.json
// 在 npx cap sync 之前运行（npm run cap:sync 已串联）。
// ============================================================

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function sync(src, dst) {
  fs.copyFileSync(src, dst);
  console.log(`[sync] ${path.relative(ROOT, src)} → ${path.relative(ROOT, dst)}`);
}

// 提示词
sync(path.join(ROOT, 'prompts-default.json'), path.join(ROOT, 'public', 'prompts-default.json'));

// 世界书
const wbDir = path.join(ROOT, 'public', 'worldbook');
fs.mkdirSync(wbDir, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'worldbook'))) {
  if (f.endsWith('.json')) {
    sync(path.join(ROOT, 'worldbook', f), path.join(wbDir, f));
  }
}

// 校验：public 副本必须与源一致（防漂移）
const same = (a, b) => fs.readFileSync(a, 'utf8') === fs.readFileSync(b, 'utf8');
const okS = same(path.join(ROOT, 'prompts-default.json'), path.join(ROOT, 'public', 'prompts-default.json'));
console.log('[sync] 完成，校验', okS ? '通过' : '失败');
if (!okS) process.exit(1);
