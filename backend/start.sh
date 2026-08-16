#!/bin/sh
# 容器啟動流程：等資料庫就緒 -> 建表與初始資料 -> 啟動服務
set -e

echo "==> 等待資料庫就緒"
python - <<'PY'
import sys, time
from sqlalchemy import create_engine
from app.config import settings

for attempt in range(1, 31):
    try:
        create_engine(settings.server_url, pool_pre_ping=True).connect().close()
        print(f"    資料庫已就緒（第 {attempt} 次嘗試）")
        sys.exit(0)
    except Exception as exc:
        print(f"    等待中… {attempt}/30 {type(exc).__name__}")
        time.sleep(2)

print("    資料庫連線逾時，請檢查 DB_HOST / DB_PASSWORD 等環境變數")
sys.exit(1)
PY

echo "==> 建立資料表與初始資料"
python -m app.seed

echo "==> 啟動 API"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8080}"
