import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

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


def _friendly_db_error(exc: Exception) -> tuple[int, str]:
    """把資料庫的英文錯誤翻成看得懂、而且知道下一步怎麼做的中文。"""
    raw = str(getattr(exc, "orig", exc))

    if "Data too long" in raw or "value too long" in raw.lower():
        # 抓出是哪一個欄位，例如 Data too long for column 'source_url' at row 1
        import re
        m = re.search(r"column '([^']+)'", raw)
        field = m.group(1) if m else ""
        names = {
            "source_url": "原文連結",
            "cover_url": "封面圖片網址",
            "image_url": "圖片網址",
            "title": "標題",
            "summary": "摘要",
            "subtitle": "副標題",
            "note": "備註",
        }
        label = names.get(field, field or "某個欄位")
        return 400, (
            f"「{label}」的內容太長，資料庫存不下。"
            "如果是很長的社群網址，請重新啟動一次後端讓資料表自動加寬，或改貼短一點的連結。"
        )

    if isinstance(exc, IntegrityError):
        if "Duplicate entry" in raw or "UNIQUE constraint" in raw:
            return 400, "這筆資料和現有的重複了（例如 Email 或代碼已經被使用）。"
        if "foreign key" in raw.lower():
            return 400, "關聯的資料不存在或已被刪除，請重新整理後再試。"
        return 400, "資料不符合限制，無法儲存。請檢查必填欄位是否都填了。"

    if isinstance(exc, OperationalError):
        return 503, "資料庫暫時連不上，請稍後再試。如果一直這樣，請確認資料庫服務是否還在運作。"

    return 500, "伺服器處理這筆資料時發生問題，已記錄下來。"


@app.middleware("http")
async def error_to_json(request: Request, call_next):
    """把所有沒被接住的例外都變成帶 CORS 標頭的中文 JSON。

    為什麼一定要在 middleware 這一層做，而不是用 @app.exception_handler(Exception)：

    Starlette 的處理順序是
        ServerErrorMiddleware → 使用者的 middleware（含 CORS）→ ExceptionMiddleware → 路由
    而註冊給 Exception 的 handler 是交給**最外層**的 ServerErrorMiddleware，
    那一層在 CORSMiddleware 外面，所以回應不會帶 Access-Control-Allow-Origin。

    結果就是瀏覽器只會說「已被 CORS 政策封鎖」——
    明明真正的原因是「網址太長，資料庫存不下」，卻長得像跨網域設定壞掉，
    這種誤導性的錯誤訊息會讓人往完全錯誤的方向查半天。

    寫成 middleware 並且放在 CORS 之前宣告，CORS 就會包在外面（後加的在最外層），
    錯誤回應也就帶得到標頭了。
    """
    try:
        return await call_next(request)
    except SQLAlchemyError as exc:
        status, message = _friendly_db_error(exc)
        log.exception("資料庫錯誤 %s %s", request.method, request.url.path)
        return JSONResponse(status_code=status, content={"detail": message})
    except Exception as exc:  # noqa: BLE001 - 最後一道防線，什麼都不能漏
        log.exception("未處理的錯誤 %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": f"伺服器發生未預期的錯誤（{type(exc).__name__}），已記錄下來。"},
        )


# CORS 一定要最後加。Starlette 的 middleware 是「後加的在最外層」，
# 放最後才能包住上面的錯誤回應，讓它們也帶到 CORS 標頭。
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
