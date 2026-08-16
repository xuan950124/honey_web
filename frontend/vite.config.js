import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 監聽區域網路，同一個 Wi-Fi 下的手機才能連進來測試
    host: true,
    proxy: {
      // 開發時把 API 與圖片請求轉給 FastAPI（預設 8000 埠）
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
