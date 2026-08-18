import asyncio
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

from .config import settings
from .database import Base, SessionLocal, engine, ensure_database, sync_schema
from .routers import (
    auth, content, logistics, membership, orders, payments, products, seo, uploads,
)

# 讓我們自己的 log.info／log.warning 真的出現在平台的日誌裡。
# uvicorn 只設定它自己的 logger，root logger 預設沒有 handler，
# 沒有這一行的話啟動階段的訊息會全部消失，出事時完全沒有線索。
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("honey")


def say(message: str) -> None:
    """一定要出現在日誌裡的訊息。直接 print 到 stdout，
    不管 logging 怎麼設定，Zeabur 的日誌都看得到。"""
    print(message, flush=True)

# 這裡在 import 階段執行，一旦拋例外容器會直接死掉（連日誌都不容易看出原因），
# 所以就算建不出資料夾也只記錄不中斷 —— 上傳功能壞掉遠好過整站掛掉。
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_OK = True
try:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
except OSError as exc:
    UPLOADS_OK = False
    print(f"[啟動] 無法建立上傳資料夾 {UPLOAD_DIR}：{exc}", flush=True)

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

@app.middleware("http")
async def security_headers(request: Request, call_next):
    """幾個基本的安全標頭。

    nosniff 特別重要：上傳的檔案是靜態提供的，
    沒有這個標頭時瀏覽器會「猜」內容型別，一個內容是 HTML 的 .jpg
    有機會被當成網頁執行，變成儲存型 XSS。
    """
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/uploads"):
        # 上傳的檔案一律不當網頁執行
        response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


if UPLOADS_OK:
    app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

app.include_router(auth.router)
app.include_router(products.router)
app.include_router(content.router)
app.include_router(orders.router)
app.include_router(uploads.router)
app.include_router(logistics.router)
app.include_router(payments.router)
app.include_router(membership.router)
app.include_router(seo.router)


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


# ------------------------------------------------------------------ 啟動

# 資料庫準備好了嗎。前端要能分辨「程式掛了」跟「資料庫還沒好」，
# 這兩件事的處理方式完全不同。
DB_STATE: dict[str, object] = {"ready": False, "error": None, "attempts": 0}

INIT_RETRY_SECONDS = 15      # 資料庫還沒好時，每 15 秒再試一次
INIT_MAX_ATTEMPTS_AT_BOOT = 6  # 啟動時最多等 6 次（約 90 秒）


def _backfill_order_tokens() -> int:
    """幫舊訂單補上存取碼。

    加這個欄位之前建立的訂單沒有存取碼，會變成任何人都打不開（連本人也是，
    如果是訪客下單的話）。啟動時補一次，之後就正常了。
    """
    from .models import Order
    from .routers.orders import new_access_token

    db = SessionLocal()
    try:
        pending = db.query(Order).filter(Order.access_token.is_(None)).all()
        for order in pending:
            order.access_token = new_access_token()
        if pending:
            db.commit()
        return len(pending)
    finally:
        db.close()


def _init_database_once() -> None:
    """建資料庫、建表、補欄位。三步各自防護，一步失敗不影響下一步。"""
    ensure_database()
    Base.metadata.create_all(bind=engine)
    sync_schema()
    filled = _backfill_order_tokens()
    if filled:
        say(f"[啟動] 已為 {filled} 筆舊訂單補上存取碼")


def _try_init_database() -> bool:
    """試一次初始化。成功回 True。"""
    DB_STATE["attempts"] = int(DB_STATE["attempts"]) + 1
    n = DB_STATE["attempts"]
    try:
        _init_database_once()
    except Exception as exc:  # noqa: BLE001
        DB_STATE["ready"] = False
        DB_STATE["error"] = f"{type(exc).__name__}: {exc}"
        say(f"[啟動] 資料庫初始化失敗（第 {n} 次）：{type(exc).__name__}: {exc}")
        log.warning("資料庫初始化失敗（第 %s 次）", n, exc_info=True)
        return False
    DB_STATE["ready"] = True
    DB_STATE["error"] = None
    say(f"[啟動] 資料庫初始化完成（第 {n} 次嘗試）")
    return True


async def _init_database_with_retry() -> None:
    """啟動時初始化資料庫，失敗就在背景一直重試。

    為什麼不讓它直接拋出例外：拋出的話 startup 事件失敗、uvicorn 直接結束，
    整個網站變成 502 —— 而瀏覽器只會顯示「已被 CORS 政策封鎖」，
    看不出來是資料庫的問題，非常難查。

    在 Zeabur 這種平台上，應用常常比資料庫先啟動。
    第一次連不上是很正常的事，那不該是永久性的死亡，而是等一下再試。
    """
    for _ in range(INIT_MAX_ATTEMPTS_AT_BOOT):
        if await asyncio.to_thread(_try_init_database):
            return
        await asyncio.sleep(INIT_RETRY_SECONDS)

    waited = INIT_MAX_ATTEMPTS_AT_BOOT * INIT_RETRY_SECONDS
    say(f"[啟動] 資料庫在 {waited} 秒內都連不上。網站仍會啟動，"
        f"但 API 會回 503。最後的錯誤：{DB_STATE['error']}")
    say("[啟動] 請檢查 DB_HOST / DB_USER / DB_PASSWORD / DB_NAME 這四個環境變數，"
        "以及資料庫服務是否還在運作。連得回來之後系統會自己恢復，不用手動重啟。")
    # 繼續在背景慢慢試，資料庫回來就會自己好，不需要人工重啟
    while not DB_STATE["ready"]:
        await asyncio.sleep(INIT_RETRY_SECONDS * 4)
        await asyncio.to_thread(_try_init_database)


@app.on_event("startup")
async def on_startup() -> None:
    say(f"[啟動] 蜂蜜商城 API 啟動中．環境 ={settings.APP_ENV}"
        f"．允許的來源 ={settings.cors_list}")
    # 刻意不 await —— 資料庫慢的話不要卡住整個啟動，
    # 這樣 /api/health 立刻就能回應，平台的健康檢查才不會判定失敗把容器殺掉。
    asyncio.create_task(_init_database_with_retry())
    asyncio.create_task(_expire_unpaid_loop())
    say("[啟動] HTTP 服務已就緒（資料庫在背景初始化）")


# ------------------------------------------------------------------ 健康檢查

@app.get("/api/health")
def health():
    """程式活著嗎。**刻意不碰資料庫** —— 這支要能在資料庫掛掉時照樣回 200，
    平台的健康檢查才不會因為資料庫暫時抽風就把容器殺掉重啟。"""
    return {"status": "ok"}


@app.get("/api/health/db")
def health_db():
    """資料庫連得上嗎。排查時先看這一支，就知道問題在哪一層。"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        DB_STATE["ready"] = True
        DB_STATE["error"] = None
        return {"status": "ok", "ready": True, "attempts": DB_STATE["attempts"]}
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            status_code=503,
            content={
                "status": "error",
                "ready": False,
                "attempts": DB_STATE["attempts"],
                "detail": "資料庫連不上。請確認資料庫服務是否啟動，以及 DB_HOST／DB_USER／"
                          "DB_PASSWORD／DB_NAME 是否正確。",
                "error": f"{type(exc).__name__}: {exc}"[:300],
            },
        )
