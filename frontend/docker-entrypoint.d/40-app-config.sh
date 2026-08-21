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

# 網站圖示與分享大圖，代理到後端的固定網址。
#
# 一定要從**前端這個網域**提供 ——
# Google 抓 favicon 只看首頁的靜態 HTML，而且圖示要跟首頁同網域。
# 直接在 index.html 寫後端網址（api.xxx.com）不算數，
# 前端載入後用 JS 換掉更沒有用，Google 那時候早就抓完走了。
mkdir -p /etc/nginx/site-icon
if [ -n "$API_BASE" ]; then
    cat > /etc/nginx/site-icon/proxy.conf <<ICON
location = /favicon.ico   { proxy_pass ${API_BASE}/favicon.ico;  proxy_ssl_server_name on; }
location = /site-icon.png { proxy_pass ${API_BASE}/site-icon;    proxy_ssl_server_name on; }
location = /og-cover.jpg  { proxy_pass ${API_BASE}/og-cover.jpg; proxy_ssl_server_name on; }
ICON
else
    # 後端網址沒設定時，退回專案內建的圖示，
    # 至少不要讓 /favicon.ico 掉進 SPA fallback 回一頁 HTML
    cat > /etc/nginx/site-icon/proxy.conf <<ICON
location = /favicon.ico   { try_files /favicon.svg =404; }
location = /site-icon.png { try_files /favicon.svg =404; }
ICON
fi

if [ -n "$API_BASE" ]; then
    echo "[前端] API 位址：$API_BASE"
    echo "[前端] robots.txt 已產生，sitemap 指向 ${API_BASE}/sitemap.xml"
    echo "[前端] 網站圖示代理到 ${API_BASE}/site-icon"
else
    echo "[前端] 警告：VITE_API_BASE 未設定，API 將走相對路徑而失敗"
fi
