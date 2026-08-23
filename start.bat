@echo off
chcp 65001 >nul
title 篮球人生 Basketball Life
cd /d "%~dp0"

echo.
echo ============================================
echo   篮球人生 (Basketball Life)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装: https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\express\" (
    echo [安装] 首次运行，正在安装依赖...
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
    echo [提示] 端口 3000 已被占用，游戏可能已在运行。
    echo        即将打开 http://localhost:3000
    start "" http://localhost:3000
    pause
    exit /b 0
)

echo [启动] 游戏服务器运行中: http://localhost:3000
echo        关闭本窗口即停止游戏
echo.
start "" http://localhost:3000
node server.js
pause
