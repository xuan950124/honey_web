# 後端：FastAPI + uvicorn
# 用 Dockerfile 而不是靠自動偵測，因為 Zeabur 預設會把空的 app/__init__.py
# 當成進入點而啟動失敗。這樣寫最確定。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Taipei

# TZ=Asia/Taipei 要真的生效，容器裡必須有時區資料。
#
# python:3.12-slim **沒有內建 tzdata** —— 少了它，設 TZ 不會報錯，
# 只會安靜地退回 UTC。症狀是所有時間差 8 小時：
# 訂單成立時間不對、每天 00:00 的流量報告變成早上 8 點才送，
# 而且統計的「今天」是從台灣時間早上 8 點才換日。
# 全部都是「看起來有在動、數字就是怪」的那種問題。
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

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
