@echo off
chcp 950 >nul
title 蜂蜜網站 - 測試寄信設定
pushd "%~dp0backend"
set "VPY="
if exist "venv\Scripts\python.exe" set "VPY=venv\Scripts\python.exe"
if not defined VPY if exist "venv\bin\python.exe" set "VPY=venv\bin\python.exe"
if not defined VPY (
    echo 請先執行「啟動後端.bat」建立環境。
    pause & exit /b
)
echo.
set /p MAILTO=請輸入要收測試信的信箱（直接按 Enter 用 .env 裡的 SMTP_USER）：
echo.
"%VPY%" -m app.test_mail %MAILTO%
popd
echo.
pause
