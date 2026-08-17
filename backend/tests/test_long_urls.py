"""長網址與錯誤回報的測試。

起因：後台貼上一條 Facebook 貼文網址後，存檔一直回 500。
瀏覽器顯示的是「已被 CORS 政策封鎖」，看起來像跨網域設定壞了，
實際上是那條網址有 753 個字元，超過 VARCHAR(400) 的欄位上限。

執行：
    cd backend
    python tests/test_long_urls.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import String, Text  # noqa: E402
from sqlalchemy.exc import DataError, IntegrityError, OperationalError  # noqa: E402

from app.database import (  # noqa: E402
    _add_column_sql, _current_width, _target_width, _widen_sql, should_widen,
)
from app.main import _friendly_db_error  # noqa: E402
from app.models import Base, News, Product, ProductImage, SiteSetting, Story  # noqa: E402

# 使用者實際貼進後台的那一條，一字不改
REAL_URL = (
    "https://www.facebook.com/klsogood/posts/-%E6%AD%A1%E8%BF%8E%E4%BE%86%E5%88%B0"
    "%E7%91%AA%E9%99%B5%E5%9D%91%E7%9A%84%E7%9A%87%E9%BE%8D%E9%A4%8A%E8%9C%82%E5%A0%B4"
    "-%E5%A6%82%E6%9E%9C%E4%BD%A0%E5%96%9C%E6%AD%A1%E8%9C%9C%E8%9C%82%E9%87%8E%E8%8A%B1"
    "%E8%9C%9C%E5%92%8C%E6%8E%A2%E7%B4%A2%E6%AD%B7%E5%8F%B2%E9%82%A3%E9%BA%BC%E9%80%99"
    "%E8%A3%A1%E7%B5%95%E5%B0%8D%E6%98%AF%E4%BD%A0%E7%9A%84%E5%A4%A9%E5%A0%82"
    "-%E7%9A%87%E9%BE%8D%E9%A4%8A%E8%9C%82%E5%A0%B4%E6%8F%90%E4%BE%9B%E5%A4%9A%E6%AC%BE"
    "%E8%87%AA%E5%AE%B6%E8%9C%9C%E8%9C%82%E6%8E%A1%E9%9B%86%E7%9A%84%E9%87%8E%E8%8A%B1"
    "%E8%9C%9C%E5%AE%83%E5%80%91%E7%9A%84%E9%87%8E%E8%8A%B1%E8%9C%9C%E6%9B%BE%E7%B6%93"
    "%E8%A2%AB%E5%9F%BA%E9%9A%86%E7%BE%8E%E9%A3%9F%E9%83%A8%E8%90%BD%E5%AE%A2%E8%A2%81"
    "%E5%BD%AC%E8%AE%9A/632400825740072/"
)

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


def is_text(column) -> bool:
    return "TEXT" in type(column.type).__name__.upper()


def limit_of(column) -> int | None:
    return getattr(column.type, "length", None)


# ---------------------------------------------------------------- 欄位型別

def test_url_columns_are_text():
    print("\n[存網址的欄位都要是 TEXT]")

    url_columns = [
        ("news.source_url", News.__table__.c.source_url),
        ("news.cover_url", News.__table__.c.cover_url),
        ("stories.cover_url", Story.__table__.c.cover_url),
        ("products.image_url", Product.__table__.c.image_url),
        ("product_images.image_url", ProductImage.__table__.c.image_url),
        ("site_settings.value", SiteSetting.__table__.c.value),
    ]
    for name, column in url_columns:
        check(f"{name} 是 TEXT", is_text(column), type(column.type).__name__)

    check("使用者那條網址是 753 字元", len(REAL_URL) == 753, str(len(REAL_URL)))
    check("753 字元超過原本的 400 上限", len(REAL_URL) > 400)


def test_text_columns_have_no_limit():
    print("\n[TEXT 欄位沒有長度上限]")
    for name, column in [
        ("news.source_url", News.__table__.c.source_url),
        ("news.cover_url", News.__table__.c.cover_url),
    ]:
        check(f"{name} 沒有 length 限制", limit_of(column) is None, str(limit_of(column)))


def test_other_fields_wide_enough():
    print("\n[其他欄位夠不夠寬]")
    # 使用者實際的標題：Hi海 基隆鎖管季推薦：瑪陵坑「皇龍養蜂場」— 蜂蜜與歷史的甜蜜相遇
    real_title = "Hi海 基隆鎖管季推薦：瑪陵坑「皇龍養蜂場」— 蜂蜜與歷史的甜蜜相遇"
    check(f"標題上限 {limit_of(News.__table__.c.title)} 放得下實際標題（{len(real_title)} 字）",
          limit_of(News.__table__.c.title) > len(real_title))
    check("標題上限至少 300", limit_of(News.__table__.c.title) >= 300,
          str(limit_of(News.__table__.c.title)))
    check("摘要上限至少 600", limit_of(News.__table__.c.summary) >= 600,
          str(limit_of(News.__table__.c.summary)))
    check("故事標題上限至少 300", limit_of(Story.__table__.c.title) >= 300,
          str(limit_of(Story.__table__.c.title)))


# ---------------------------------------------------------------- 欄位加寬邏輯

def test_width_helpers():
    print("\n[判斷欄位要不要加寬]")

    class FakeCol:
        def __init__(self, type_):
            self.type = type_

    def db_col(type_):
        return {"type": type_}

    # 目前的寬度
    check("VARCHAR(400) 讀成 400", _current_width(db_col(String(400))) == 400,
          str(_current_width(db_col(String(400)))))
    check("TEXT 視為非常寬", _current_width(db_col(Text())) > 10 ** 6,
          str(_current_width(db_col(Text()))))

    # 目標寬度
    check("模型的 VARCHAR(300) 是 300", _target_width(FakeCol(String(300))) == 300)
    check("模型的 TEXT 視為非常寬", _target_width(FakeCol(Text())) > 10 ** 6)

    # 真正的判斷：只加寬，不縮小
    def needs_widening(have_type, want_type):
        have = _current_width(db_col(have_type))
        want = _target_width(FakeCol(want_type))
        if have is None or want is None:
            return False
        return want > have

    check("VARCHAR(400) → TEXT 要加寬", needs_widening(String(400), Text()))
    check("VARCHAR(200) → VARCHAR(300) 要加寬", needs_widening(String(200), String(300)))
    check("TEXT → TEXT 不用動", not needs_widening(Text(), Text()))
    check("VARCHAR(300) → VARCHAR(300) 不用動", not needs_widening(String(300), String(300)))
    check("TEXT → VARCHAR(400) 不會被縮小", not needs_widening(Text(), String(400)),
          "縮小會截斷既有資料，絕對不能做")
    check("VARCHAR(500) → VARCHAR(300) 不會被縮小", not needs_widening(String(500), String(300)))

    # 非字串型別要被忽略，不然會對數字欄位下奇怪的 ALTER
    from sqlalchemy import Integer, Numeric
    check("整數欄位回 None", _current_width(db_col(Integer())) is None)
    check("金額欄位回 None", _current_width(db_col(Numeric(10, 2))) is None)


def test_generated_sql():
    """檢查真的要送去 MySQL 的那幾行 SQL 長什麼樣。

    沙箱裡沒有 MySQL 可以連，但 SQL 字串本身就是最容易寫錯的地方
    （少一個反引號、NOT NULL 掉了、型別編譯成 SQLite 的寫法），所以至少要驗這個。
    """
    print("\n[產生出來的 ALTER TABLE]")
    from sqlalchemy.dialects import mysql
    dialect = mysql.dialect()

    sql = _widen_sql("news", News.__table__.c.source_url, dialect)
    print(f"       {sql}")
    check("加寬用 MODIFY", "MODIFY" in sql, sql)
    check("加寬指定正確的表", "`news`" in sql, sql)
    check("加寬指定正確的欄位", "`source_url`" in sql, sql)
    check("加寬成 TEXT", "TEXT" in sql, sql)
    check("可為空的欄位標 NULL", sql.rstrip().endswith(" NULL") and "NOT NULL" not in sql, sql)
    check("沒有殘留的 %s 佔位符", "%" not in sql, sql)

    # NOT NULL 的欄位不能被改成可空，那會讓既有的約束消失
    sql_nn = _widen_sql("product_images", ProductImage.__table__.c.image_url, dialect)
    print(f"       {sql_nn}")
    check("NOT NULL 的欄位保持 NOT NULL", sql_nn.rstrip().endswith("NOT NULL"), sql_nn)

    # 新增欄位（既有功能，不能被我改壞）
    from app.models import Order
    sql_add = _add_column_sql("orders", Order.__table__.c.payment_attempts, dialect)
    print(f"       {sql_add}")
    check("新增欄位用 ADD COLUMN", "ADD COLUMN" in sql_add, sql_add)
    check("有預設值的欄位帶 DEFAULT", "DEFAULT 0" in sql_add, sql_add)

    sql_add2 = _add_column_sql("orders", Order.__table__.c.cancel_reason, dialect)
    print(f"       {sql_add2}")
    check("可為空的新欄位不加 NOT NULL", "NOT NULL" not in sql_add2, sql_add2)

    # 型別要編成 MySQL 的寫法，不能混到 SQLite 的
    check("型別是 MySQL 方言", "VARCHAR" in sql_add2 or "TEXT" in sql_add2, sql_add2)


def test_should_widen_skips_indexed():
    print("\n[有索引的欄位不能亂改]")

    def db_col(type_):
        return {"type": type_}

    # 這些欄位有索引或唯一約束，改成 TEXT 會讓 MySQL 抱怨索引長度
    protected = [
        ("users.email", News.__table__.c.title, True),   # 用來對照的一般欄位
    ]
    from app.models import User, Order
    check("users.email（unique+index）不加寬",
          not should_widen(db_col(String(50)), User.__table__.c.email))
    check("orders.order_no（unique+index）不加寬",
          not should_widen(db_col(String(10)), Order.__table__.c.order_no))
    check("site_settings.key（主鍵）不加寬",
          not should_widen(db_col(String(10)), SiteSetting.__table__.c.key))

    # 一般欄位該加寬就要加寬
    check("news.source_url 從 VARCHAR(400) 要加寬",
          should_widen(db_col(String(400)), News.__table__.c.source_url))
    check("news.source_url 已經是 TEXT 就不動",
          not should_widen(db_col(Text()), News.__table__.c.source_url))
    check("news.title 從 VARCHAR(200) 要加寬到 300",
          should_widen(db_col(String(200)), News.__table__.c.title))
    check("news.title 已經 300 就不動",
          not should_widen(db_col(String(300)), News.__table__.c.title))
    _ = protected


def test_all_model_columns_covered():
    print("\n[全部模型欄位的寬度都算得出來]")
    # SQLAlchemy 裡 Text 與 Enum 都繼承 String，所以一個 isinstance 就夠
    text_like = [c for t in Base.metadata.sorted_tables for c in t.columns
                 if isinstance(c.type, String)]
    other = [c for t in Base.metadata.sorted_tables for c in t.columns
             if not isinstance(c.type, String)]

    bad_text = [c.name for c in text_like if _target_width(c) is None]
    check(f"{len(text_like)} 個字串欄位都算得出寬度", not bad_text, str(bad_text))

    bad_other = [c.name for c in other if _target_width(c) is not None]
    check(f"{len(other)} 個非字串欄位都被跳過", not bad_other, str(bad_other))

    # 每個字串欄位的寬度都要是正數，不然 ALTER 會產生 VARCHAR(0) 這種東西
    bad_width = [c.name for c in text_like if (_target_width(c) or 0) <= 0]
    check("沒有寬度為 0 的欄位", not bad_width, str(bad_width))


# ---------------------------------------------------------------- 錯誤訊息

def test_friendly_errors():
    print("\n[資料庫錯誤翻成中文]")

    too_long = DataError(
        "INSERT INTO news ...", {},
        Exception('(1406, "Data too long for column \'source_url\' at row 1")'),
    )
    status, message = _friendly_db_error(too_long)
    check("長度超過回 400（不是 500）", status == 400, str(status))
    check("訊息指名是原文連結", "原文連結" in message, message)
    check("訊息有告訴下一步", "重新啟動" in message or "短一點" in message, message)
    check("訊息不含英文原文", "Data too long" not in message, message)

    # 其他欄位也要翻對
    for field, label in [("title", "標題"), ("cover_url", "封面圖片網址"), ("summary", "摘要")]:
        err = DataError("INSERT", {}, Exception(f"(1406, \"Data too long for column '{field}'\")"))
        _, msg = _friendly_db_error(err)
        check(f"{field} 翻成「{label}」", label in msg, msg)

    # 認不出來的欄位名不能讓訊息變成 None 或空白
    unknown = DataError("INSERT", {}, Exception("(1406, \"Data too long for column 'zzz'\")"))
    _, msg = _friendly_db_error(unknown)
    check("沒對照的欄位仍給得出訊息", "zzz" in msg and len(msg) > 10, msg)

    no_field = DataError("INSERT", {}, Exception("Data too long"))
    _, msg = _friendly_db_error(no_field)
    check("抓不到欄位名也不會壞", "某個欄位" in msg, msg)

    dup = IntegrityError("INSERT", {}, Exception("Duplicate entry 'a@b.com' for key 'email'"))
    status, msg = _friendly_db_error(dup)
    check("重複資料回 400", status == 400, str(status))
    check("重複資料的訊息看得懂", "重複" in msg, msg)

    fk = IntegrityError("INSERT", {}, Exception("Cannot add or update a child row: a foreign key constraint fails"))
    _, msg = _friendly_db_error(fk)
    check("外鍵錯誤的訊息看得懂", "關聯" in msg, msg)

    down = OperationalError("SELECT 1", {}, Exception("(2003, \"Can't connect to MySQL server\")"))
    status, msg = _friendly_db_error(down)
    check("連不上資料庫回 503", status == 503, str(status))
    check("連不上的訊息有建議", "稍後" in msg, msg)

    # 每一種都必須是中文、非空、不外洩 SQL
    for exc in (too_long, dup, fk, down):
        _, msg = _friendly_db_error(exc)
        check(f"{type(exc).__name__} 的訊息不外洩 SQL",
              "INSERT" not in msg and "SELECT" not in msg, msg)
        check(f"{type(exc).__name__} 的訊息不是空的", len(msg) > 8, msg)


# ---------------------------------------------------------------- 端到端

def test_save_real_url():
    print("\n[真的把那條 753 字元的網址存進去]")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()

    item = News(
        title="Hi海 基隆鎖管季推薦：瑪陵坑「皇龍養蜂場」— 蜂蜜與歷史的甜蜜相遇",
        category="news",
        source_url=REAL_URL,
        summary="皇龍養蜂場提供多款自家蜜蜂採集的野花蜜。",
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    check("存得進去", item.id is not None)
    check("網址一個字都沒少", item.source_url == REAL_URL,
          f"存了 {len(item.source_url or '')} 字元，原本 {len(REAL_URL)}")

    # 再更新一次（使用者當時是按「編輯」存檔失敗的）
    item.source_url = REAL_URL + "?extra=1"
    db.commit()
    db.refresh(item)
    check("更新也沒問題", item.source_url.endswith("?extra=1"))

    # 極端一點：2000 字元
    item.source_url = "https://example.com/" + "x" * 2000
    db.commit()
    db.refresh(item)
    check("2000 字元也存得下", len(item.source_url) > 2000, str(len(item.source_url)))
    db.close()


def test_error_response_has_cors():
    print("\n[錯誤回應要帶 CORS 標頭]")
    from fastapi.testclient import TestClient
    from app.main import app

    @app.get("/api/_test_db_error")
    def _db_error():
        raise DataError("INSERT", {}, Exception("(1406, \"Data too long for column 'source_url'\")"))

    @app.get("/api/_test_other_error")
    def _other_error():
        raise ValueError("boom")

    client = TestClient(app, raise_server_exceptions=False)
    origin = {"Origin": "https://huanglong-honey.com"}

    for path, want_status in [("/api/_test_db_error", 400), ("/api/_test_other_error", 500)]:
        r = client.get(path, headers=origin)
        check(f"{path} 狀態碼 {want_status}", r.status_code == want_status, str(r.status_code))
        check(f"{path} 有 CORS 標頭",
              r.headers.get("access-control-allow-origin") == "https://huanglong-honey.com",
              repr(r.headers.get("access-control-allow-origin")))
        check(f"{path} 回的是 JSON",
              "json" in (r.headers.get("content-type") or ""), r.headers.get("content-type"))
        detail = r.json().get("detail", "")
        check(f"{path} 有中文說明", bool(detail) and any(c > "一" for c in detail), detail)

    # 正常請求不能被影響
    r = client.get("/api/health", headers=origin)
    check("正常請求還是 200", r.status_code == 200, str(r.status_code))
    check("正常請求也有 CORS 標頭",
          r.headers.get("access-control-allow-origin") == "https://huanglong-honey.com")

    # 404 這種既有行為不能被改掉
    r = client.get("/api/does-not-exist", headers=origin)
    check("不存在的路徑還是 404", r.status_code == 404, str(r.status_code))


if __name__ == "__main__":
    print("=" * 60)
    print("長網址與錯誤回報測試")
    print("=" * 60)
    import logging
    logging.disable(logging.CRITICAL)   # 測試會刻意觸發例外，不用印一堆 traceback

    for fn in (
        test_url_columns_are_text, test_text_columns_have_no_limit,
        test_other_fields_wide_enough, test_width_helpers,
        test_generated_sql, test_should_widen_skips_indexed,
        test_all_model_columns_covered, test_friendly_errors,
        test_save_real_url, test_error_response_has_cors,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
