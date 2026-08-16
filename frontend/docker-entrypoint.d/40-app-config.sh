#!/bin/sh
# nginx 官方映像檔會自動執行 /docker-entrypoint.d/ 底下的 *.sh。
# 這裡把環境變數寫進 config.js，讓前端在「執行階段」就能拿到後端網址，
# 不需要在建置時寫死（Zeabur 不會把環境變數傳進 Docker build 階段）。
set -e

API_BASE="${VITE_API_BASE:-${API_BASE:-}}"
API_BASE="${API_BASE%/}"   # 去掉結尾多餘的斜線

cat > /usr/share/nginx/html/config.js <<CONFIG
window.__APP_CONFIG__ = { apiBase: "${API_BASE}" };
CONFIG

if [ -n "$API_BASE" ]; then
    echo "[前端] API 位址：$API_BASE"
else
    echo "[前端] 警告：VITE_API_BASE 未設定，API 將走相對路徑而失敗"
fi
