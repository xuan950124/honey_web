# 後端：FastAPI + uvicorn
# 用 Dockerfile 而不是靠自動偵測，因為 Zeabur 預設會把空的 app/__init__.py
# 當成進入點而啟動失敗。這樣寫最確定。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Taipei

WORKDIR /app

# 先只複製 requirements，讓 Docker 能快取這層，之後改程式碼不用重裝套件
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

COPY . .

# 上傳的照片放這裡。務必在 Zeabur 的「硬碟」掛載一個 Volume 到 /app/uploads，
# 否則每次重新部署照片都會不見。
RUN mkdir -p /app/uploads /app/outbox
VOLUME ["/app/uploads"]

EXPOSE 8080
CMD ["sh", "/app/start.sh"]
