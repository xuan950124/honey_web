# 前端：Vite 打包成靜態檔，用 nginx 提供
FROM node:20-alpine AS build
WORKDIR /src

COPY package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

# 後端 API 網址。Vite 會在「建置階段」把這個值寫死進打包結果，
# 所以在 Zeabur 改了這個環境變數之後，必須重新部署才會生效。
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build

FROM nginx:alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
