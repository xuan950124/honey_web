@echo off
chcp 950 >nul
title 蜂蜜網站 - 重建資料庫
setlocal
pushd "%~dp0backend"
set "VPY="
if exist "venv\Scripts\python.exe" set "VPY=venv\Scripts\python.exe"
if not defined VPY if exist "venv\bin\python.exe" set "VPY=venv\bin\python.exe"
if not defined VPY (
    echo 請先執行「啟動後端.bat」。
    pause & exit /b
)
echo 重新建立資料表與示範資料...
"%VPY%" -m app.seed
popd
echo.
pause
