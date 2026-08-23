#!/usr/bin/env bash
# 篮球人生 — Linux/macOS/Git Bash 启动脚本
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  篮球人生 (Basketball Life)"
echo "============================================"
echo ""

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org/"
    exit 1
fi

# 首次运行安装依赖
if [ ! -d "node_modules/express" ]; then
    echo "[安装] 首次运行，正在安装依赖..."
    npm install --no-audit --no-fund || exit 1
fi

# 端口占用检测
if command -v netstat >/dev/null 2>&1 && netstat -an 2>/dev/null | grep ":3000" | grep -q LISTEN; then
    echo "[提示] 端口 3000 已被占用，游戏可能已在运行。"
    echo "       直接访问 http://localhost:3000 或先关闭旧进程。"
    echo ""
    exit 0
fi

echo "[启动] 游戏服务器运行中：http://localhost:3000"
echo "       按 Ctrl+C 停止"
echo ""

# 尝试自动打开浏览器（无图形环境时静默跳过）
( sleep 1
  if command -v start >/dev/null 2>&1; then start "" "http://localhost:3000" 2>/dev/null
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:3000" 2>/dev/null
  elif command -v open >/dev/null 2>&1; then open "http://localhost:3000" 2>/dev/null
  fi
) &

node server.js
