"""啟動韌性測試：資料庫出問題時，網站不能整個掛掉。

起因：加了「自動加寬欄位」之後推上正式環境，整站變成 502。
瀏覽器顯示的是「已被 CORS 政策封鎖」，實際上是後端根本沒起來 ——
sync_schema() 裡有一句 ALTER 失敗，例外一路拋到 startup 事件，
uvicorn 判定啟動失敗直接結束，連 /docs 都打不開。

這份測試就是要釘住「不管資料庫怎麼壞，HTTP 服務都要活著」。

執行：
    cd backend
    python tests/test_startup_resilience.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
# 背景工作會在另一個執行緒開資料庫連線，跟測試自己的連線互相干擾
# （SQLite 的 StaticPool 只有一條連線，交易會互相蓋掉）。測試一律關掉。
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import String, Text, create_engine, text  # noqa: E402
from sqlalchemy.exc import OperationalError  # noqa: E402

from app import database, main  # noqa: E402
from app.database import indexed_columns, should_widen, sync_schema  # noqa: E402
from app.models import Base, News  # noqa: E402

ORIGIN = {"Origin": "https://huanglong-honey.com"}

passed = 0
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(f"{name}{f' — {detail}' if detail else ''}")
        print(f"  FAIL {name}{f' — {detail}' if detail else ''}")


# ---------------------------------------------------------------- ALTER 失敗

def test_sync_schema_survives_failures():
    print("\n[單句 ALTER 失敗不能中斷同步]")

    # 用一個真的資料庫，但把 execute 換成「特定語句一定失敗」
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    original_engine = database.engine
    database.engine = engine

    calls = {"total": 0, "boom": 0}

    class BoomConn:
        def __init__(self, real):
            self._real = real

        def execute(self, statement, *a, **kw):
            calls["total"] += 1
            sql = str(statement)
            if "news" in sql:            # 只讓 news 那幾句爆炸
                calls["boom"] += 1
                raise OperationalError(sql, {}, Exception("模擬的 ALTER 失敗"))
            return self._real.execute(statement, *a, **kw)

        def __getattr__(self, item):
            return getattr(self._real, item)

    class BoomBegin:
        def __init__(self, real_engine):
            self._engine = real_engine

        def __call__(self):
            return self

        def __enter__(self):
            self._ctx = self._engine.begin()
            return BoomConn(self._ctx.__enter__())

        def __exit__(self, *exc):
            return self._ctx.__exit__(*exc)

    # 讓模型比資料庫寬，製造出要加寬的語句
    engine.begin = BoomBegin(create_engine("sqlite://"))

    try:
        # 呼叫本身絕對不能拋例外
        raised = None
        try:
            sync_schema()
        except Exception as exc:  # noqa: BLE001
            raised = exc
        check("sync_schema 不會拋出例外", raised is None, repr(raised))
    finally:
        database.engine = original_engine

    print("       （SQLite 不檢查長度，所以這裡驗的是「例外不會往上拋」）")


def test_sync_schema_never_raises_on_broken_db():
    print("\n[完全連不上資料庫時，sync_schema 也要安靜收場]")

    original_engine = database.engine
    # 指向一個一定連不上的 MySQL
    database.engine = create_engine(
        "mysql+pymysql://nobody:nothing@127.0.0.1:1/nope", pool_pre_ping=False
    )
    try:
        raised = None
        try:
            sync_schema()
        except Exception as exc:  # noqa: BLE001
            raised = exc
        check("連不上資料庫時 sync_schema 不拋例外", raised is None, repr(raised))
    finally:
        database.engine = original_engine


# ---------------------------------------------------------------- 索引保護

def test_indexed_columns():
    print("\n[問資料庫實際有哪些索引]")
    from sqlalchemy import inspect

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    inspector = inspect(engine)

    users = indexed_columns(inspector, "users")
    check("users.email 被認出有索引", "email" in users, str(sorted(users)))
    check("users.id（主鍵）被認出", "id" in users, str(sorted(users)))

    orders = indexed_columns(inspector, "orders")
    check("orders.order_no 被認出有索引", "order_no" in orders, str(sorted(orders)))
    check("orders.user_id（外鍵）被認出", "user_id" in orders, str(sorted(orders)))
    check("orders.note 沒有索引", "note" not in orders)

    # 讀不到索引時要保守處理（回 {"*"}），寧可不改也不要下錯的 ALTER
    class Broken:
        def get_indexes(self, _):
            raise RuntimeError("讀不到")

    check("讀不到索引時保守回傳", indexed_columns(Broken(), "x") == {"*"})


def test_should_widen_respects_real_indexes():
    print("\n[有索引的欄位不能改成 TEXT]")

    def db_col(type_):
        return {"type": type_}

    col = News.__table__.c.source_url
    check("沒有索引 → 可以加寬", should_widen(db_col(String(400)), col, set()))
    check("資料庫上有索引 → 不加寬",
          not should_widen(db_col(String(400)), col, {"source_url"}),
          "MySQL 會報 BLOB/TEXT column used in key specification")
    check("其他欄位有索引不影響這一欄",
          should_widen(db_col(String(400)), col, {"title", "id"}))
    check("讀不到索引（{'*'}）時仍會加寬單一欄位",
          should_widen(db_col(String(400)), col, {"*"}),
          "'*' 只是佔位，不會誤擋具名欄位")


# ---------------------------------------------------------------- HTTP 要活著

def test_app_starts_without_database():
    print("\n[資料庫連不上時 HTTP 服務仍要活著]")
    from fastapi.testclient import TestClient

    original_engine = database.engine
    broken = create_engine(
        "mysql+pymysql://nobody:nothing@127.0.0.1:1/nope", pool_pre_ping=False
    )
    database.engine = broken

    # 把重試間隔縮短，測試不要等 90 秒
    original_retry = main.INIT_RETRY_SECONDS
    original_attempts = main.INIT_MAX_ATTEMPTS_AT_BOOT
    main.INIT_RETRY_SECONDS = 0
    main.INIT_MAX_ATTEMPTS_AT_BOOT = 1

    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            r = client.get("/api/health", headers=ORIGIN)
            check("/api/health 仍回 200", r.status_code == 200, str(r.status_code))
            check("/api/health 不碰資料庫", r.json() == {"status": "ok"}, str(r.json()))
            check("/api/health 有 CORS 標頭",
                  r.headers.get("access-control-allow-origin") == ORIGIN["Origin"])

            r = client.get("/api/health/db", headers=ORIGIN)
            check("/api/health/db 回 503", r.status_code == 503, str(r.status_code))
            body = r.json()
            check("/api/health/db 說明是中文", "資料庫連不上" in body.get("detail", ""),
                  str(body.get("detail")))
            check("/api/health/db 有列出要檢查的環境變數",
                  "DB_HOST" in body.get("detail", ""), str(body.get("detail")))
            check("/api/health/db 有 CORS 標頭",
                  r.headers.get("access-control-allow-origin") == ORIGIN["Origin"])

            # 真正的 API 應該回帶 CORS 的 503，而不是讓瀏覽器看到 CORS 錯誤
            r = client.get("/api/settings", headers=ORIGIN)
            check("/api/settings 回 503（不是 500）", r.status_code == 503, str(r.status_code))
            check("/api/settings 有 CORS 標頭",
                  r.headers.get("access-control-allow-origin") == ORIGIN["Origin"],
                  repr(r.headers.get("access-control-allow-origin")))
            check("/api/settings 的訊息看得懂",
                  "資料庫" in r.json().get("detail", ""), str(r.json().get("detail")))

            # OPTIONS 預檢一定要過，不然瀏覽器連錯誤內容都拿不到
            r = client.options(
                "/api/settings",
                headers={**ORIGIN, "Access-Control-Request-Method": "GET",
                         "Access-Control-Request-Headers": "authorization"},
            )
            check("OPTIONS 預檢回 200", r.status_code == 200, str(r.status_code))
            check("OPTIONS 預檢有 CORS 標頭",
                  r.headers.get("access-control-allow-origin") == ORIGIN["Origin"],
                  repr(r.headers.get("access-control-allow-origin")))
            check("OPTIONS 預檢允許 Authorization 標頭",
                  "authorization" in (r.headers.get("access-control-allow-headers") or "").lower(),
                  repr(r.headers.get("access-control-allow-headers")))
    finally:
        database.engine = original_engine
        main.INIT_RETRY_SECONDS = original_retry
        main.INIT_MAX_ATTEMPTS_AT_BOOT = original_attempts
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


def test_app_works_with_database():
    print("\n[資料庫正常時一切照舊]")
    from fastapi.testclient import TestClient
    from sqlalchemy.pool import StaticPool

    good = create_engine("sqlite://", connect_args={"check_same_thread": False},
                         poolclass=StaticPool)
    original_engine = database.engine
    database.engine = good
    original_session = database.SessionLocal
    from sqlalchemy.orm import sessionmaker
    database.SessionLocal = sessionmaker(bind=good)

    try:
        Base.metadata.create_all(good)
        with TestClient(main.app, raise_server_exceptions=False) as client:
            r = client.get("/api/health", headers=ORIGIN)
            check("/api/health 回 200", r.status_code == 200, str(r.status_code))

            r = client.get("/api/health/db", headers=ORIGIN)
            check("/api/health/db 回 200", r.status_code == 200, str(r.status_code))
            check("/api/health/db 說 ready", r.json().get("ready") is True, str(r.json()))

            r = client.get("/api/settings", headers=ORIGIN)
            check("/api/settings 回 200", r.status_code == 200, str(r.status_code))
            check("/api/settings 回得出設定", "shop_name" in r.json(), str(r.json())[:120])
    finally:
        database.engine = original_engine
        database.SessionLocal = original_session
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


def test_background_jobs_flag():
    print("\n[背景工作的開關]")
    from app.config import settings

    check("設定裡有這個開關", hasattr(settings, "ENABLE_BACKGROUND_JOBS"))
    check("測試環境已關閉", settings.ENABLE_BACKGROUND_JOBS is False,
          str(settings.ENABLE_BACKGROUND_JOBS))

    src = (Path(__file__).resolve().parent.parent / "app/main.py").read_text("utf-8")
    start = src.index("async def on_startup")
    body = src[start:start + 900]
    check("啟動時會檢查這個開關", "ENABLE_BACKGROUND_JOBS" in body, body[:200])
    check("關閉時不會排程資料表初始化",
          body.index("ENABLE_BACKGROUND_JOBS") < body.index("_init_database_with_retry"))
    check("關閉時不會排程逾期清理",
          body.index("ENABLE_BACKGROUND_JOBS") < body.index("_expire_unpaid_loop"))

    # 預設必須是開的 —— 正式環境沒有背景工作就不會自動建表也不會清逾期訂單
    from app.config import Settings
    check("預設是開啟", Settings.model_fields["ENABLE_BACKGROUND_JOBS"].default is True)

    # 背景工作要現查連線設定，不能在 import 時綁死
    check("背景工作用現查的 SessionLocal", "database.SessionLocal()" in src,
          "綁死的話重新設定連線後它還會抓舊的，很難查")
    check("main 沒有直接 import SessionLocal",
          "from .database import Base, ensure_database, sync_schema" in src)


def test_retry_state():
    print("\n[重試狀態記錄]")
    original_engine = database.engine
    database.engine = create_engine(
        "mysql+pymysql://nobody:nothing@127.0.0.1:1/nope", pool_pre_ping=False
    )
    main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})
    try:
        ok = main._try_init_database()
        check("連不上時回 False", ok is False)
        check("有記下嘗試次數", main.DB_STATE["attempts"] == 1, str(main.DB_STATE["attempts"]))
        check("有記下錯誤原因", bool(main.DB_STATE["error"]), str(main.DB_STATE["error"]))
        check("ready 為 False", main.DB_STATE["ready"] is False)

        main._try_init_database()
        check("次數會累加", main.DB_STATE["attempts"] == 2, str(main.DB_STATE["attempts"]))
    finally:
        database.engine = original_engine
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


if __name__ == "__main__":
    print("=" * 60)
    print("啟動韌性測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)   # 測試會刻意觸發例外

    for fn in (
        test_sync_schema_survives_failures,
        test_sync_schema_never_raises_on_broken_db,
        test_indexed_columns,
        test_should_widen_respects_real_indexes,
        test_app_starts_without_database,
        test_app_works_with_database,
        test_background_jobs_flag,
        test_retry_state,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
