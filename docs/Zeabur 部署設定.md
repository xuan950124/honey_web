# Zeabur 部署設定

你已經開好三個服務，架構是對的：

| 服務 | 根目錄 | 用途 |
|---|---|---|
| `honey-web-frontend` | `/frontend` | React 前端（靜態網站）|
| `honey-web-backend` | `/backend` | FastAPI 後端 |
| `mysql` | — | 資料庫 |

底下是讓它們真的跑起來要做的設定。

---

## 第 0 步：先把新檔案推上 GitHub

我新增了幾個部署必需的檔案，**沒推上去 Zeabur 建置會失敗**：

```
backend/Dockerfile
backend/start.sh
backend/.dockerignore
frontend/Dockerfile
frontend/nginx.conf
frontend/.dockerignore
```

在專案資料夾執行：

```bash
git add .
git commit -m "加入 Zeabur 部署設定"
git push
```

> 我確認過你的 `.env` **沒有**被上傳（`.gitignore` 有擋住），MySQL 密碼與 Gmail 應用程式密碼是安全的。
> 之後也請不要把 `.env` 加進 git。

### 為什麼要用 Dockerfile

Zeabur 的 Python 自動偵測會把 `app/__init__.py` 當成進入點，而我們那個檔案是空的，
會找不到 FastAPI 應用程式而啟動失敗。寫 Dockerfile 可以完全確定啟動方式，不用跟自動偵測賭。

前端也需要 Dockerfile，因為 React Router 是前端路由 —— 直接開 `/products/3` 這種網址時，
伺服器上並沒有對應的檔案，必須設定成一律回傳 `index.html`（nginx 的 `try_files`）。
沒設定的話，使用者重新整理任何內頁都會 404。

---

## 第 1 步：後端環境變數

進入 `honey-web-backend` → **環境變數** → 建議直接用「編輯原始環境變數」貼上：

```ini
# ---- 資料庫（${...} 會自動抓 mysql 服務的值）----
DB_HOST=${MYSQL_HOST}
DB_PORT=${MYSQL_PORT}
DB_USER=${MYSQL_USERNAME}
DB_PASSWORD=${MYSQL_PASSWORD}
DB_NAME=${MYSQL_DATABASE}

# ---- 應用設定 ----
APP_ENV=production
SECRET_KEY=請換成一段夠長的隨機字串
ADMIN_EMAIL=a0930081500@gmail.com
ADMIN_PASSWORD=請換成你自己的強密碼
ADMIN_NAME=黃皇龍

# ---- 網址（${ZEABUR_WEB_URL} 是這個服務自己的公開網址）----
BACKEND_BASE_URL=${ZEABUR_WEB_URL}
FRONTEND_BASE_URL=https://前端的網址
CORS_ORIGINS=https://前端的網址

# ---- 寄信 ----
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=你的Gmail
SMTP_PASSWORD=十六碼應用程式密碼
SMTP_FROM=你的Gmail
SMTP_FROM_NAME=皇龍蜂蜜
SMTP_TLS=true
SMTP_SSL=false

# ---- 綠界（先維持測試環境，確定流程沒問題再換正式金鑰）----
ECPAY_ENV=stage
```

### 幾個重點

**`${MYSQL_...}` 是 Zeabur 的變數引用語法**，會自動填入 mysql 服務的實際值，
不用自己複製貼上密碼。如果變數名稱對不上，到 mysql 服務的「環境變數」頁看實際的名稱。

**`${ZEABUR_WEB_URL}`** 是「這個服務自己的公開網址」，Zeabur 會自動代入。
所以 `BACKEND_BASE_URL` 不用手動填，換網域也不用改。

**`FRONTEND_BASE_URL` 和 `CORS_ORIGINS` 要手動填**前端的網址，
因為跨服務只能引用對方「有曝露」的變數。等第 3 步拿到前端網址再回來填。

**`SECRET_KEY` 一定要換掉**。這是簽發登入權杖用的，用預設值等於誰都能偽造登入。
隨便產生一串長的隨機字元即可。

**`ADMIN_PASSWORD` 也一定要換掉**，`admin1234` 上線是很危險的。

---

## 第 2 步：後端掛載硬碟（很重要，不做照片會不見）

容器每次重新部署都是全新的，寫進容器裡的檔案會消失。
**你從後台上傳的商品照片就存在容器裡**，不掛硬碟的話每次部署照片就全沒了。

`honey-web-backend` → **硬碟** → 新增：

| 欄位 | 值 |
|---|---|
| 掛載路徑 | `/app/uploads` |
| 大小 | 1 GB 起（照片不多的話很夠）|

---

## 第 3 步：開對外網域

兩個服務都要開，在各自的 **網路** 頁面：

1. `honey-web-backend` → 網路 → 產生網域，例如 `honey-api.zeabur.app`
2. `honey-web-frontend` → 網路 → 產生網域，例如 `honey-shop.zeabur.app`

拿到網址後，回第 1 步把後端的 `FRONTEND_BASE_URL` 與 `CORS_ORIGINS` 填成前端網址。

> mysql 服務**不要**開對外網域，資料庫暴露在公網很危險。
> 後端是走專案內部網路連它的。

---

## 第 4 步：前端環境變數

進入 `honey-web-frontend` → **環境變數**：

```ini
VITE_API_BASE=https://honey-api.zeabur.app
```

（換成你後端實際的網址，**結尾不要加斜線**）

### ⚠️ 這個變數改了一定要重新部署

Vite 是在**建置階段**就把這個值寫死進打包結果的，不是執行時讀取。
所以改完之後要按「重新部署」，只重啟服務沒有用。

本機開發時這個變數留空即可，會走 `vite.config.js` 的 proxy。

---

## 第 5 步：確認啟動

看 `honey-web-backend` 的**記錄**，正常會看到：

```
==> 等待資料庫就緒
    資料庫已就緒（第 1 次嘗試）
==> 建立資料表與初始資料
[建立] 工作人員帳號 ...
==> 啟動 API
INFO:     Uvicorn running on http://0.0.0.0:8080
```

然後打開 `https://你的後端網址/docs`，看得到 API 文件就成功了。

前端打開網址，商品列表有東西出現就代表前後端接通了。

---

## 第 6 步：綠界設定

因為後端現在有公開的 HTTPS 網址了，**綠界的自動通知終於可以正常運作** ——
付款完成、物流狀態變更都會自動更新，不用再手動按「向綠界查詢付款狀態」。

不用做任何額外設定，`BACKEND_BASE_URL=${ZEABUR_WEB_URL}` 已經處理好了。

確定測試環境流程都正常之後，再把綠界換成正式金鑰：

```ini
ECPAY_ENV=production
ECPAY_MERCHANT_ID=你的金流廠商編號
ECPAY_HASH_KEY=...
ECPAY_HASH_IV=...
ECPAY_C2C_MERCHANT_ID=你的物流廠商編號
ECPAY_C2C_HASH_KEY=...
ECPAY_C2C_HASH_IV=...
ECPAY_HOME_MERCHANT_ID=同物流廠商編號
ECPAY_HOME_HASH_KEY=...
ECPAY_HOME_HASH_IV=...
```

---

## 第 7 步：換成自己的網域（選用）

`.zeabur.app` 的網址能用，但自己的網域比較專業，客人也記得住。

在服務的 **網路** 頁面可以綁定自訂網域，Zeabur 會給你 DNS 設定值，
到你買網域的地方加上對應的記錄即可。建議：

- 前端：`www.你的網域.com` 或 `shop.你的網域.com`
- 後端：`api.你的網域.com`

換好之後記得回去更新 `FRONTEND_BASE_URL`、`CORS_ORIGINS`、`VITE_API_BASE`，
並**重新部署前端**。

---

## 常見問題

**Q：後端記錄顯示「資料庫連線逾時」**
檢查 `DB_HOST` 等變數有沒有正確引用到 mysql 服務。
到後端的環境變數頁看展開後的實際值對不對。

**Q：前端打得開但商品是空的，Console 顯示 CORS 錯誤**
後端的 `CORS_ORIGINS` 沒填前端網址，或填錯了（要含 `https://`，結尾不要加斜線）。

**Q：前端打得開但 API 全部 404**
`VITE_API_BASE` 沒設定，或設定後沒有**重新部署**。
打開瀏覽器開發者工具的 Network，看請求打到哪個網址就知道了。

**Q：重新整理內頁會 404**
nginx 的 SPA fallback 沒生效，確認 `frontend/nginx.conf` 有推上 GitHub。

**Q：重新部署後上傳的照片不見了**
沒掛硬碟。回第 2 步掛 `/app/uploads`。已經不見的照片救不回來，要重新上傳。

**Q：資料庫的資料會不會不見**
mysql 服務本身有自己的儲存空間，不會因為後端重新部署而消失。
但建議定期到 mysql 服務的「備份還原」做備份。

**Q：Zeabur 免費額度夠用嗎**
初期流量小的話夠測試。實際營業建議看一下方案，
資料庫和後端要一直開著才不會有人下單時網站掛掉。
