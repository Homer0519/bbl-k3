// ============================================================
// Capacitor 运行时模拟服务器 — 验证 APK 代码路径
// 原理：静态托管 public/（与 APK assets 相同的文件），在返回 index.html 时
// 注入 cap-mock.js（定义 window.Capacitor + CapacacitorHttp 桩），
// 使 native.js 的 fetch 拦截层按 APK 方式工作。
// /llm-proxy 模拟原生 HTTP（无 CORS）：转发到 mock-llm（需先 npm run mock）。
// 用法: node test/cap-sim-server.js   （监听 3300）
// ============================================================

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PORT = 3300;
const MOCK = 'http://127.0.0.1:3001';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const server = http.createServer((req, res) => {
  // 模拟 CapacitorHttp：原生网络（无 CORS）→ 服务端转发
  if (req.method === 'POST' && req.url === '/llm-proxy') {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const body = JSON.parse(raw);
      const url = body.url;
      delete body.url;
      fetch(url, {
        method: 'POST',
        headers: body.headers || { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.data)
      }).then(async r => {
        const data = await r.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data }));
      }).catch(e => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      });
    });
    return;
  }

  // 静态文件
  let file = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const fp = path.join(PUB, file);
  if (!fp.startsWith(PUB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  let content = fs.readFileSync(fp);
  if (file === '/index.html') {
    // 注入 Capacitor 模拟（仅内存替换，不改源文件）
    content = Buffer.from(content.toString('utf8')
      .replace('<script src="/js/state.js">', '<script src="/cap-mock.js"></script>\n  <script src="/js/state.js">'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  res.end(content);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Capacitor 模拟环境: http://127.0.0.1:${PORT}`);
  console.log('（需先启动 mock: npm run mock）');
});
