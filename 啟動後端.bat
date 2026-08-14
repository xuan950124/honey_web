@echo off
chcp 950 >nul
title 蜂蜜網站 - 後端
setlocal
pushd "%~dp0backend"
if errorlevel 1 (
    echo 找不到 backend 資料夾，請確認這個 bat 和 backend 在同一層。
    pause & exit /b
)

REM ---------- 找出要用的 Python ----------
REM 依序試 3.12 / 3.13 / 3.11 / 3.10，這些版本的套件都有預編譯 wheel。
REM 太新的版本（例如 3.14）常常還沒 wheel，pip 會改去編譯 Rust 原始碼而失敗，
REM 所以放到最後才試。
set "BASEPY="
for %%V in (3.12 3.13 3.11 3.10) do (
    if not defined BASEPY (
        py -%%V --version >nul 2>nul && set "BASEPY=py -%%V"
    )
)
if not defined BASEPY (
    py -3 --version >nul 2>nul && set "BASEPY=py -3"
)
if not defined BASEPY (
    python --version >nul 2>nul && set "BASEPY=python"
)
if not defined BASEPY (
    echo.
    echo 找不到可用的 Python。請到 https://www.python.org/downloads/
    echo 下載 Python 3.12，安裝時勾選 "Add python.exe to PATH"。
    echo.
    pause & exit /b
)
echo 使用的 Python： %BASEPY%
%BASEPY% -c "import sys;print('    ',sys.version.split()[0],sys.executable)"

REM ---------- 檢查現有 venv ----------
set "VPY="
if exist "venv\Scripts\python.exe" set "VPY=venv\Scripts\python.exe"
if not defined VPY if exist "venv\bin\python.exe" set "VPY=venv\bin\python.exe"

REM 舊 venv 若是太新的 Python 建的，砍掉重建
if defined VPY (
    "%VPY%" -c "import sys;raise SystemExit(0 if sys.version_info.minor in (10,11,12,13) else 1)" >nul 2>nul
    if errorlevel 1 (
        echo 現有 venv 的 Python 版本不合適，重新建立...
        rmdir /s /q venv
        set "VPY="
    )
)
if exist "venv" if not defined VPY (
    echo 現有 venv 不完整，重新建立...
    rmdir /s /q venv
)

if not defined VPY (
    echo [1/4] 建立虛擬環境...
    %BASEPY% -m venv venv
    if exist "venv\Scripts\python.exe" set "VPY=venv\Scripts\python.exe"
    if not defined VPY if exist "venv\bin\python.exe" set "VPY=venv\bin\python.exe"
)
if not defined VPY (
    echo.
    echo 虛擬環境建立失敗。請手動執行：
    echo     cd /d "%~dp0backend"
    echo     py -3.12 -m venv venv
    echo.
    pause & exit /b
)
echo 虛擬環境： %VPY%

REM ---------- .env ----------
if not exist ".env" (
    copy ".env.example" ".env" >nul
    echo.
    echo ==========================================================
    echo   已建立 backend\.env
    echo   請把 DB_PASSWORD 改成你的 MySQL 密碼，存檔關掉，
    echo   然後再點一次這個 bat。
    echo ==========================================================
    echo.
    notepad ".env"
    pause & exit /b
)

REM ---------- 套件 ----------
echo.
echo [2/4] 安裝/檢查套件...
"%VPY%" -m pip install -q --upgrade pip setuptools wheel
"%VPY%" -m pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 (
    echo.
    echo 改用一般模式再試一次...
    "%VPY%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo 套件安裝失敗，請把上面的錯誤訊息貼給我。
        pause & exit /b
    )
)

REM ---------- 資料庫 ----------
echo.
echo [3/4] 建立資料表與示範資料...
"%VPY%" -m app.seed
if errorlevel 1 (
    echo.
    echo 資料庫連線失敗，請檢查：
    echo    1. MySQL 服務有沒有啟動
    echo    2. backend\.env 的 DB_PASSWORD 是否正確
    echo.
    pause & exit /b
)

REM ---------- 啟動 ----------
echo.
echo [4/4] 後端啟動中： http://127.0.0.1:8000/docs
echo      停止請按 Ctrl+C
echo.
"%VPY%" -m uvicorn app.main:app --reload --port 8000
popd
pause
