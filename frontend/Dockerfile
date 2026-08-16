# 前端：Vite 打包成靜態檔，用 nginx 提供
FROM node:20-alpine AS build
WORKDIR /src

COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 容器啟動時把 VITE_API_BASE 寫進 config.js。
# 用「執行階段」注入而不是建置階段，因為 Zeabur 不會把服務的環境變數
# 傳進 Docker build，寫成 ARG 會拿不到值。
COPY docker-entrypoint.d/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
RUN chmod +x /docker-entrypoint.d/40-app-config.sh

EXPOSE 8080
