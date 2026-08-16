@echo off
chcp 950 >nul
title 蜂蜜網站 - 查看本機區域網路位址
echo.
echo   把手機連上同一個 Wi-Fi，然後在手機瀏覽器輸入下面的網址：
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=* delims= " %%b in ("%%a") do (
        echo        http://%%b:5173
    )
)
echo.
echo   注意：前端和後端兩個視窗都要開著。
echo   如果連不上，多半是 Windows 防火牆擋住了，
echo   第一次執行時跳出的提示請選「允許存取」。
echo.
pause
