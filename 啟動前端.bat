@echo off
chcp 950 >nul
title 蜂蜜網站 - 前端
pushd "%~dp0frontend"
if errorlevel 1 (
    echo 找不到 frontend 資料夾。
    pause
    exit /b
)

where npm >nul 2>nul
if errorlevel 1 (
    echo 找不到 npm 指令，請先安裝 Node.js。
    pause
    exit /b
)

if not exist "node_modules\vite" (
    echo 安裝前端套件，第一次會跑比較久...
    call npm install
    if errorlevel 1 (
        echo npm install 失敗。
        pause
        exit /b
    )
)

echo.
echo 啟動前端： http://localhost:5173
echo 要停止請按 Ctrl+C
echo.
call npm run dev
popd
pause
