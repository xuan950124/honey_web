"""瀏覽統計：隱私、排除、以及數字算得對不對。

## 這一份的重點是隱私

流量統計最容易做成「順手把 IP 存下來」—— 而 IP 在個資法下是個人資料，
存了就要面對蒐集目的告知、保存期限、當事人權利那一整套。

所以這裡的設計是**存不下來**：雜湊而且每天換鹽。
測試要證明的不是「我們承諾不存」，是「資料表裡真的沒有」。

執行：
    cd backend
    python tests/test_analytics.py
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import analytics, database, main  # noqa: E402
from app.models import Base, PageView, SiteSetting, User, UserRole  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent

REAL_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
           "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1")

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


def make_app():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    database.engine = engine
    database.SessionLocal = Session

    db = Session()
    db.add(User(id=1, email="staff@huanglong-honey.com", name="工作人員",
                hashed_password=hash_password("x"), role=UserRole.staff))
    db.add(User(id=2, email="member@huanglong-honey.com", name="會員",
                hashed_password=hash_password("x"), role=UserRole.member))
    db.commit()
    db.close()

    from fastapi.testclient import TestClient
    return (TestClient(main.app, raise_server_exceptions=False), Session,
            {"Authorization": f"Bearer {create_access_token(1)}"},
            {"Authorization": f"Bearer {create_access_token(2)}"})


# ---------------------------------------------------------------- 隱私

def test_never_stores_ip():
    """資料表裡不能出現原始 IP。

    這不是「我們承諾不存」，是要證明資料表裡真的沒有 ——
    就算資料庫外流也一樣。
    """
    print("\n[不會存下 IP]")
    client, Session, _, _ = make_app()
    ip = "203.0.113.45"

    db = Session()
    analytics.record(db, path="/products/1", ip=ip, user_agent=REAL_UA)
    db.close()

    db = Session()
    row = db.query(PageView).first()
    check("有記到一筆", row is not None)
    dump = " ".join(str(v) for v in row.__dict__.values())
    check("整列資料裡找不到 IP", ip not in dump, dump[:200])
    check("欄位名裡也沒有 ip",
          not any("ip" == c.name for c in PageView.__table__.columns),
          str([c.name for c in PageView.__table__.columns]))
    check("存的是 64 字元的雜湊", len(row.visitor_hash) == 64, row.visitor_hash)
    db.close()


def test_salt_rotates_daily():
    """鹽每天換 —— 所以**跨日追蹤不了同一個人**。

    這是隱私設計的核心：不是靠承諾，是靠算不出來。
    代價是同一個人隔天再來會被算成兩位訪客，
    所以後台畫面要講清楚，不然會以為系統算錯。
    """
    print("\n[鹽每天換]")
    client, Session, _, _ = make_app()
    db = Session()

    first = analytics.daily_salt(db)
    check("同一天拿到同一組鹽", analytics.daily_salt(db) == first)

    hash_today = analytics.visitor_hash(db, "203.0.113.45", REAL_UA)
    check("同一天同一個人算出同樣的雜湊",
          analytics.visitor_hash(db, "203.0.113.45", REAL_UA) == hash_today)
    check("不同人算出不同雜湊",
          analytics.visitor_hash(db, "203.0.113.99", REAL_UA) != hash_today)

    # 把「上次換鹽的日期」改成昨天，模擬跨日
    row = db.get(SiteSetting, analytics.SALT_DAY_KEY)
    row.value = (date.today() - timedelta(days=1)).isoformat()
    db.commit()

    second = analytics.daily_salt(db)
    check("跨日之後鹽會換掉", second != first)
    check("同一個人隔天算出來的雜湊不一樣",
          analytics.visitor_hash(db, "203.0.113.45", REAL_UA) != hash_today,
          "追蹤得到跨日的同一個人，就等於留了一條可以還原個人的線索")
    db.close()


def test_no_query_string_stored():
    """查詢字串不能留 —— 訂單頁的網址帶存取碼。"""
    print("\n[不留查詢字串]")
    check("存取碼被切掉",
          analytics.clean_path("/order/20260822001?t=SECRET_TOKEN") == "/order/20260822001",
          "留下來等於把訂單的鑰匙寫進統計資料表")
    check("錨點也切掉", analytics.clean_path("/products/3#spec") == "/products/3")
    check("補上開頭的斜線", analytics.clean_path("products") == "/products")
    check("空的變成首頁", analytics.clean_path("") == "/")

    check("來源只留網域",
          analytics.referrer_host("https://www.google.com/search?q=秘密") == "www.google.com")
    check("沒有來源就是 None", analytics.referrer_host("") is None)
    check("壞掉的網址不會爆", analytics.referrer_host("not a url") is None)


# ---------------------------------------------------------------- 排除

def test_excludes_staff():
    """工作人員自己在逛不算流量。

    你每天開後台看十次、逛自己的網站確認排版 ——
    那些數字會蓋掉真實客人的樣子，統計就失去意義了。
    """
    print("\n[工作人員不計入]")
    client, Session, staff, member = make_app()

    with client:
        r = client.post("/api/stats/view", json={"path": "/products/1"},
                        headers={**staff, "User-Agent": REAL_UA})
        check("工作人員的請求回 200", r.status_code == 200, str(r.status_code))
        check("但不計入", r.json()["counted"] is False, r.text[:150])
        check("而且說得出原因", r.json().get("reason") == "staff", r.text[:150])

        r = client.post("/api/stats/view", json={"path": "/products/1"},
                        headers={**member, "User-Agent": REAL_UA})
        check("一般會員照樣計入", r.json()["counted"] is True,
              "會員是真的客人，當然要算")

        r = client.post("/api/stats/view", json={"path": "/products/1"},
                        headers={"User-Agent": REAL_UA})
        check("沒登入的訪客也計入", r.json()["counted"] is True)

    db = Session()
    check("資料表裡只有兩筆（工作人員那筆沒進去）",
          db.query(PageView).count() == 2, str(db.query(PageView).count()))
    db.close()


def test_excludes_bots_and_private_pages():
    print("\n[爬蟲與內部頁面不計入]")
    client, Session, _, _ = make_app()

    bots = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "facebookexternalhit/1.1",
        "python-requests/2.31.0",
        "curl/8.4.0",
        "Mozilla/5.0 (compatible; UptimeRobot/2.0)",
    ]
    for ua in bots:
        check(f"擋掉 {ua[:28]}", analytics.is_bot(ua) is True)
    check("真的手機瀏覽器不算爬蟲", analytics.is_bot(REAL_UA) is False)
    check("沒有 User-Agent 當成爬蟲", analytics.is_bot("") is True,
          "真人的瀏覽器一定會帶 UA")

    for path in ("/admin", "/admin/orders", "/cart", "/order/123", "/member",
                 "/login", "/register"):
        check(f"{path} 不計入", analytics.is_ignored_path(path) is True)
    for path in ("/", "/products", "/products/3", "/news/1", "/contact", "/group-buy"):
        check(f"{path} 要計入", analytics.is_ignored_path(path) is False)

    with client:
        r = client.post("/api/stats/view", json={"path": "/products/1"},
                        headers={"User-Agent": bots[0]})
        check("爬蟲打進來也不會被記", r.json()["counted"] is False)
        r = client.post("/api/stats/view", json={"path": "/admin/orders"},
                        headers={"User-Agent": REAL_UA})
        check("後台路徑打進來也不會被記", r.json()["counted"] is False)

    db = Session()
    check("資料表是空的", db.query(PageView).count() == 0)
    db.close()


def test_frontend_exclusions():
    """前端也要先擋一次 —— 不然使用者的瀏覽器會白白送出一堆請求。"""
    print("\n[前端的排除]")
    hook = (ROOT / "frontend/src/hooks/usePageTracking.js").read_text("utf-8")

    check("工作人員不送", "if (isStaff || isOptedOut()) return" in hook)
    check("有「這台裝置不計入」的開關", "OPT_OUT_KEY" in hook)
    check("手機版預覽不送", "preview" in hook and "return" in hook,
          "預覽是把自己的網站塞進 iframe，算進去等於一次瀏覽變兩次")
    check("站內換頁不送 referrer", "!== window.location.origin" in hook,
          "不然來源統計整片都是自己，看不出客人真正從哪裡來")
    check("失敗完全不管", ".catch(() => {})" in hook,
          "統計送不出去不該在訪客的主控台留紅字")

    app_jsx = (ROOT / "frontend/src/App.jsx").read_text("utf-8")
    check("App 有掛上追蹤", "PageTracker" in app_jsx)

    page = (ROOT / "frontend/src/pages/admin/AdminStats.jsx").read_text("utf-8")
    check("後台有排除說明", "哪些人不會被計入" in page)
    check("後台有那個開關", "setOptedOut" in page)
    check("有說明數字為什麼會偏高",
          "算成兩位" in page,
          "同一個人隔天再來算兩位是刻意的，不講清楚會被當成算錯")

    layout = (ROOT / "frontend/src/pages/admin/AdminLayout.jsx").read_text("utf-8")
    check("後台選單有流量統計", "/admin/stats" in layout)


# ---------------------------------------------------------------- 數字

def test_summary_numbers():
    print("\n[統計數字]")
    client, Session, staff, member = make_app()
    db = Session()

    # 兩個人各看兩頁 + 一個人只看一頁 = 5 次瀏覽、3 個訪客
    for ip in ("203.0.113.1", "203.0.113.2"):
        analytics.record(db, path="/", ip=ip, user_agent=REAL_UA,
                         referrer="https://www.google.com/search?q=x")
        analytics.record(db, path="/products/1", ip=ip, user_agent=REAL_UA)
    analytics.record(db, path="/", ip="203.0.113.3", user_agent=REAL_UA)

    data = analytics.summary(db, days=30)
    check("瀏覽次數 5", data["today"]["views"] == 5, str(data["today"]))
    check("不重複訪客 3", data["today"]["visitors"] == 3, str(data["today"]))
    check("熱門頁面第一名是首頁", data["top_pages"][0]["path"] == "/", str(data["top_pages"]))
    check("首頁 3 次瀏覽 / 3 人", data["top_pages"][0]["views"] == 3
          and data["top_pages"][0]["visitors"] == 3, str(data["top_pages"][0]))
    hosts = {s["host"] for s in data["sources"]}
    check("來源有 google", "www.google.com" in hosts, str(hosts))
    check("沒有來源的顯示成看得懂的字",
          any("直接輸入" in h for h in hosts), str(hosts))
    db.close()

    with client:
        r = client.get("/api/stats/summary", headers=staff)
        check("工作人員看得到統計", r.status_code == 200, str(r.status_code))
        for label, headers in (("未登入", {}), ("一般會員", member)):
            check(f"{label} 看不到統計",
                  client.get("/api/stats/summary", headers=headers).status_code
                  in (401, 403))

        check("天數超出範圍會被擋",
              client.get("/api/stats/summary?days=9999", headers=staff).status_code == 422)


def test_old_rows_are_purged():
    """資料會過期。一天幾百筆看起來沒什麼，一年就是十幾萬列。"""
    print("\n[舊資料會自動清掉]")
    client, Session, _, _ = make_app()
    db = Session()

    old_day = (date.today() - timedelta(days=analytics.RETENTION_DAYS + 5)).isoformat()
    db.add(PageView(path="/", visitor_hash="a" * 64, day=old_day))
    db.add(PageView(path="/", visitor_hash="b" * 64, day=date.today().isoformat()))
    db.commit()

    deleted = analytics.purge_old(db)
    check("刪掉一筆舊的", deleted == 1, str(deleted))
    check("今天的還在", db.query(PageView).count() == 1)
    db.close()

    src = (ROOT / "backend/app/main.py").read_text("utf-8")
    check("背景工作會定期清", "analytics.purge_old" in src)
    check("清理失敗不影響訂單清理",
          "統計的清理失敗不該影響訂單清理" in src,
          "兩件事綁在一起的話，統計壞掉會連帶讓庫存卡住")


if __name__ == "__main__":
    print("=" * 60)
    print("瀏覽統計測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_never_stores_ip, test_salt_rotates_daily, test_no_query_string_stored,
        test_excludes_staff, test_excludes_bots_and_private_pages,
        test_frontend_exclusions, test_summary_numbers, test_old_rows_are_purged,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
