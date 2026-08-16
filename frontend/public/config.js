// 執行階段設定。
//
// 本機開發：apiBase 留空，API 走相對路徑，由 vite.config.js 的 proxy 轉發。
// 正式部署：容器啟動時會用環境變數覆寫這個檔案（見 docker-entrypoint.d/40-app-config.sh），
//          所以改後端網址只要「重啟」服務即可，不需要重新建置。
window.__APP_CONFIG__ = { apiBase: '' };
