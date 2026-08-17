import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .database import Base, SessionLocal, engine, ensure_database, sync_schema
from .routers import (
    auth, content, logistics, membership, orders, payments, products, uploads,
)

log = logging.getLogger(__name__)

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title="蜂蜜商城 API",
    description="蜂蜜／團購／新聞報導／品牌故事，含會員與工作人員後台",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(content.router)
app.include_router(orders.router)
app.include_router(uploads.router)
app.include_router(logistics.router)
app.include_router(payments.router)
app.include_router(membership.router)


EXPIRE_SWEEP_SECONDS = 3600  # 每小時清一次逾期未付款訂單


def _sweep_expired_once() -> int:
    """跑一次清理。整個資料庫連線的生命週期都在同一個執行緒裡，
    SQLAlchemy 的 Session 不是執行緒安全的，不要跨執行緒傳。"""
    db = SessionLocal()
    try:
        return len(orders.expire_unpaid_orders(db))
    finally:
        db.close()


async def _expire_unpaid_loop() -> None:
    """定期把逾期未付款的訂單取消並回補庫存。

    刻意跑在背景而不是「有人打開後台才順便清」——
    庫存被卡住的損失是即時的，不該等到有人來看訂單頁才處理。
    任何例外都只記錄不拋出，避免這個迴圈掛掉之後就再也不跑。
    """
    while True:
        await asyncio.sleep(EXPIRE_SWEEP_SECONDS)
        try:
            count = await asyncio.to_thread(_sweep_expired_once)
            if count:
                log.info("自動取消 %d 筆逾期未付款訂單", count)
        except Exception:  # noqa: BLE001 - 背景工作不能因為單次失敗就停掉
            log.exception("清理逾期未付款訂單時發生錯誤")


@app.on_event("startup")
async def on_startup() -> None:
    ensure_database()
    Base.metadata.create_all(bind=engine)
    sync_schema()
    asyncio.create_task(_expire_unpaid_loop())


@app.get("/api/health")
def health():
    return {"status": "ok"}
