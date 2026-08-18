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

# robots.txt 也在這裡產生，因為 Sitemap 那一行要指到後端網址。
# 後台、購物車、訂單頁一律不收錄 ——
# 訂單頁的網址帶存取碼，被搜尋引擎收錄等於外流。
cat > /usr/share/nginx/html/robots.txt <<ROBOTS
User-agent: *
Allow: /
Disallow: /admin
Disallow: /cart
Disallow: /order
Disallow: /member
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /verify-email

Sitemap: ${API_BASE}/sitemap.xml
ROBOTS

if [ -n "$API_BASE" ]; then
    echo "[前端] API 位址：$API_BASE"
    echo "[前端] robots.txt 已產生，sitemap 指向 ${API_BASE}/sitemap.xml"
else
    echo "[前端] 警告：VITE_API_BASE 未設定，API 將走相對路徑而失敗"
fi
