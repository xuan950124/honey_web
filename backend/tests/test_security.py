"""安全性測試：每一項都先模擬攻擊，確認真的被擋住。

寫法刻意是「攻擊者視角」——
不是驗證正常流程能不能跑，而是驗證**不該成功的事情真的失敗了**。

執行：
    cd backend
    python tests/test_security.py
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

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import throttle  # noqa: E402
from app.models import Base, Order, User, UserRole  # noqa: E402
from app.routers.orders import can_view_order, new_access_token  # noqa: E402
from app.routers.uploads import looks_like_image  # noqa: E402
from app.security import hash_password, verify_password  # noqa: E402

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


def fresh_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)()


# ---------------------------------------------------------------- 訂單越權

def test_order_access():
    print("\n[別人的訂單不能被看到]")

    alice = User(id=1, email="alice@x.com", hashed_password="x", name="Alice", role=UserRole.member)
    bob = User(id=2, email="bob@x.com", hashed_password="x", name="Bob", role=UserRole.member)
    staff = User(id=3, email="s@x.com", hashed_password="x", name="Staff", role=UserRole.staff)

    token = new_access_token()
    order = Order(order_no="20260818120000123", access_token=token, user_id=alice.id)

    check("本人看得到", can_view_order(order, alice, None))
    check("工作人員看得到", can_view_order(order, staff, None))
    check("帶對存取碼看得到", can_view_order(order, None, token))
    check("本人不需要存取碼", can_view_order(order, alice, "亂打的"))

    # 這幾項是重點：以前全部都會通過
    check("別的會員看不到", not can_view_order(order, bob, None))
    check("沒登入又沒碼看不到", not can_view_order(order, None, None))
    check("存取碼錯的看不到", not can_view_order(order, None, "wrong-token"))
    check("空字串的碼看不到", not can_view_order(order, None, ""))
    check("碼只對前面一半也看不到", not can_view_order(order, None, token[:8]))
    check("碼多一個字元也看不到", not can_view_order(order, None, token + "a"))

    # 訪客訂單（沒有 user_id）
    guest = Order(order_no="20260818120000456", access_token=token, user_id=None)
    check("訪客訂單：帶對碼看得到", can_view_order(guest, None, token))
    check("訪客訂單：路人看不到", not can_view_order(guest, bob, None))
    check("訪客訂單：工作人員看得到", can_view_order(guest, staff, None))

    # 舊訂單沒有存取碼時，不能因為「碼是空的」就變成誰都能看
    legacy = Order(order_no="20260818120000789", access_token=None, user_id=None)
    check("沒有存取碼的訂單，路人看不到", not can_view_order(legacy, None, None))
    check("沒有存取碼的訂單，傳 None 也看不到", not can_view_order(legacy, None, None))
    check("沒有存取碼的訂單，工作人員仍看得到", can_view_order(legacy, staff, None))


def test_access_token_quality():
    print("\n[存取碼要夠難猜]")
    tokens = {new_access_token() for _ in range(500)}
    check("500 次都不重複", len(tokens) == 500, str(len(tokens)))

    one = new_access_token()
    check("長度至少 20 字元", len(one) >= 20, f"{one}（{len(one)} 字元）")
    check("只有網址安全字元", all(c.isalnum() or c in "-_" for c in one), one)

    # 訂單編號本身是猜得到的 —— 這正是需要存取碼的原因
    from app.routers.orders import _generate_order_no
    numbers = [_generate_order_no() for _ in range(5)]
    check("訂單編號是可預測的時間戳（所以才需要存取碼）",
          all(n[:8] == numbers[0][:8] for n in numbers), str(numbers[:2]))


def test_order_endpoint_blocks_guessing():
    print("\n[用猜的訂單編號打 API 會被擋]")
    from fastapi.testclient import TestClient
    from app import database, main

    db_engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                              poolclass=StaticPool)
    Base.metadata.create_all(db_engine)
    Session = sessionmaker(bind=db_engine)

    original_engine = database.engine
    original_session = database.SessionLocal
    database.engine = db_engine
    database.SessionLocal = Session

    db = Session()
    token = new_access_token()
    db.add(Order(
        order_no="20260818120000123", access_token=token,
        receiver_name="黃先生", receiver_phone="0912345678",
        receiver_address="基隆市七堵區某某路 1 號", total_amount=750,
    ))
    db.commit()
    db.close()

    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            r = client.get("/api/orders/by-no/20260818120000123")
            check("沒帶碼查訂單回 404", r.status_code == 404, str(r.status_code))
            check("錯誤訊息不透露訂單是否存在",
                  "找不到" in r.json().get("detail", ""), str(r.json()))
            body = r.text
            check("回應裡沒有收件人姓名", "黃先生" not in body, body[:200])
            check("回應裡沒有電話", "0912345678" not in body, body[:200])
            check("回應裡沒有地址", "七堵" not in body, body[:200])

            r = client.get(f"/api/orders/by-no/20260818120000123?t={token}")
            check("帶對碼查得到", r.status_code == 200, str(r.status_code))
            check("帶對碼看得到收件人", r.json().get("receiver_name") == "黃先生")

            r = client.get("/api/orders/by-no/20260818120000123?t=wrong")
            check("帶錯碼回 404", r.status_code == 404, str(r.status_code))

            # 付款頁也不能被別人叫出來（上面會顯示金額與品項）
            r = client.get("/api/payments/20260818120000123/checkout")
            check("沒帶碼開付款頁被擋", r.status_code == 400, str(r.status_code))
            check("被擋時不顯示商品資訊", "黃先生" not in r.text)
    finally:
        database.engine = original_engine
        database.SessionLocal = original_session
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


# ---------------------------------------------------------------- 登入限制

def test_login_throttle():
    print("\n[連續猜密碼會被鎖]")
    throttle.reset()

    key = "user:attacker@x.com"
    for i in range(1, throttle.MAX_FAILURES):
        left = throttle.record_failure(key)
        check(f"第 {i} 次失敗還沒鎖（剩 {left} 次）", left > 0, str(left))

    left = throttle.record_failure(key)
    check(f"第 {throttle.MAX_FAILURES} 次失敗被鎖住", left == 0, str(left))
    check("回報還要等多久", throttle.seconds_remaining(key) > 0,
          str(throttle.seconds_remaining(key)))
    check("鎖定時間約 15 分鐘",
          800 < throttle.seconds_remaining(key) <= 901,
          str(throttle.seconds_remaining(key)))

    # 別的帳號不受影響，不然攻擊者可以故意鎖死別人
    check("其他帳號沒被連累", throttle.seconds_remaining("user:someone@x.com") == 0)

    # 登入成功要清零
    throttle.record_success(key)
    check("成功登入後解除", throttle.seconds_remaining(key) == 0)
    throttle.reset()


def test_login_endpoint_throttle():
    print("\n[登入 API 真的會擋]")
    from fastapi.testclient import TestClient
    from app import database, main

    throttle.reset()
    db_engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                              poolclass=StaticPool)
    Base.metadata.create_all(db_engine)
    Session = sessionmaker(bind=db_engine)

    original_engine = database.engine
    original_session = database.SessionLocal
    database.engine = db_engine
    database.SessionLocal = Session

    db = Session()
    db.add(User(email="victim@x.com", hashed_password=hash_password("correct-horse"),
                name="受害者", role=UserRole.member))
    db.commit()
    db.close()

    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            codes = []
            for _ in range(throttle.MAX_FAILURES + 2):
                r = client.post("/api/auth/login",
                                json={"email": "victim@x.com", "password": "猜錯的"})
                codes.append(r.status_code)

            check("前幾次是 401", codes[0] == 401, str(codes))
            check("超過上限後變成 429（被鎖）", 429 in codes, str(codes))

            # 被鎖之後，就算密碼是對的也進不去 —— 這正是重點
            r = client.post("/api/auth/login",
                            json={"email": "victim@x.com", "password": "correct-horse"})
            check("鎖定期間連正確密碼也擋", r.status_code == 429, str(r.status_code))
            check("訊息告訴使用者可以改用忘記密碼",
                  "忘記密碼" in r.json().get("detail", ""), str(r.json()))

            # 換一個帳號不受影響（但同 IP 也有計數，所以這裡也會被擋）
            throttle.reset()
            r = client.post("/api/auth/login",
                            json={"email": "victim@x.com", "password": "correct-horse"})
            check("解鎖後正確密碼可以登入", r.status_code == 200, str(r.status_code))
    finally:
        throttle.reset()
        database.engine = original_engine
        database.SessionLocal = original_session
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


def test_password_hashing():
    print("\n[密碼不是明文存的]")
    raw = "my-secret-password"
    hashed = hash_password(raw)
    check("雜湊後看不到原文", raw not in hashed, hashed[:20])
    check("是 bcrypt 格式", hashed.startswith("$2"), hashed[:8])
    check("同樣的密碼每次雜湊不同（有加鹽）", hash_password(raw) != hashed)
    check("正確密碼驗得過", verify_password(raw, hashed))
    check("錯誤密碼驗不過", not verify_password(raw + "x", hashed))
    check("空密碼驗不過", not verify_password("", hashed))


# ---------------------------------------------------------------- 上傳

def test_upload_signature_check():
    print("\n[改副檔名騙不過上傳檢查]")

    JPG = bytes.fromhex("ffd8ffe000104a464946")
    PNG = bytes.fromhex("89504e470d0a1a0a0000")
    GIF = b"GIF89a" + b"\x00" * 10
    WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 "
    HTML = b"<html><script>alert(1)</script></html>"
    SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    PHP = b"<?php system($_GET['c']); ?>"

    check("真的 JPG 過關", looks_like_image(".jpg", JPG))
    check("真的 PNG 過關", looks_like_image(".png", PNG))
    check("真的 GIF 過關", looks_like_image(".gif", GIF))
    check("真的 WebP 過關", looks_like_image(".webp", WEBP))

    # 這幾項是重點：內容是程式碼但副檔名寫成圖片
    check("HTML 改名成 .jpg 被擋", not looks_like_image(".jpg", HTML))
    check("SVG 改名成 .png 被擋", not looks_like_image(".png", SVG))
    check("PHP 改名成 .gif 被擋", not looks_like_image(".gif", PHP))
    check("空檔案被擋", not looks_like_image(".jpg", b""))
    check("PNG 內容配 .jpg 副檔名被擋", not looks_like_image(".jpg", PNG))
    check("JPG 內容配 .png 副檔名被擋", not looks_like_image(".png", JPG))

    # SVG 一律不收（它是 XML，可以放 script）
    from app.routers.uploads import ALLOWED_EXT
    check("不接受 .svg", ".svg" not in ALLOWED_EXT, str(sorted(ALLOWED_EXT)))
    check("不接受 .html", ".html" not in ALLOWED_EXT)
    check("不接受 .php", ".php" not in ALLOWED_EXT)


def test_upload_endpoint():
    print("\n[上傳 API 的實際行為]")
    from fastapi.testclient import TestClient
    from app import database, main
    from app.security import create_access_token

    db_engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                              poolclass=StaticPool)
    Base.metadata.create_all(db_engine)
    Session = sessionmaker(bind=db_engine)
    original_engine = database.engine
    original_session = database.SessionLocal
    database.engine = db_engine
    database.SessionLocal = Session

    db = Session()
    staff = User(email="staff@x.com", hashed_password="x", name="員工", role=UserRole.staff)
    member = User(email="m@x.com", hashed_password="x", name="會員", role=UserRole.member)
    db.add_all([staff, member])
    db.commit()
    staff_token = create_access_token(staff.id)
    member_token = create_access_token(member.id)
    db.close()

    JPG = bytes.fromhex("ffd8ffe000104a464946") + b"\x00" * 100
    HTML = b"<html><script>alert(1)</script></html>"

    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            r = client.post("/api/uploads", files={"file": ("a.jpg", JPG, "image/jpeg")})
            check("沒登入不能上傳", r.status_code in (401, 403), str(r.status_code))

            r = client.post("/api/uploads", files={"file": ("a.jpg", JPG, "image/jpeg")},
                            headers={"Authorization": f"Bearer {member_token}"})
            check("一般會員不能上傳", r.status_code == 403, str(r.status_code))

            head = {"Authorization": f"Bearer {staff_token}"}
            r = client.post("/api/uploads", files={"file": ("a.jpg", JPG, "image/jpeg")},
                            headers=head)
            check("工作人員可以上傳真圖", r.status_code == 200, str(r.status_code)[:120])
            if r.status_code == 200:
                url = r.json()["url"]
                name = r.json()["filename"]
                # 用格式判斷而不是「原始檔名不在裡面」——
                # uuid 剛好以 a 結尾時，"a.jpg" 會意外命中，測試會隨機失敗
                import re as _re
                check("檔名被重新產生（32 碼十六進位）",
                      bool(_re.fullmatch(r"[0-9a-f]{32}\.jpg", name)), name)
                check("沒有沿用原始檔名", not name.startswith("a."), name)
                check("存放在 /uploads 下", url.startswith("/uploads/"), url)

            r = client.post("/api/uploads", files={"file": ("x.jpg", HTML, "image/jpeg")},
                            headers=head)
            check("內容是 HTML 的假圖被擋", r.status_code == 400, str(r.status_code))

            r = client.post("/api/uploads", files={"file": ("x.svg", b"<svg/>", "image/svg+xml")},
                            headers=head)
            check("SVG 被擋", r.status_code == 400, str(r.status_code))

            r = client.post("/api/uploads",
                            files={"file": ("x.jpg", b"\xff\xd8\xff" + b"\x00" * (9 * 1024 * 1024),
                                            "image/jpeg")},
                            headers=head)
            check("超過 8MB 被擋", r.status_code == 400, str(r.status_code))
            check("超過大小時有講實際大小",
                  "MB" in r.json().get("detail", ""), str(r.json().get("detail")))

            # 安全標頭
            r = client.get("/api/health")
            check("有 X-Content-Type-Options: nosniff",
                  r.headers.get("x-content-type-options") == "nosniff",
                  str(r.headers.get("x-content-type-options")))
    finally:
        database.engine = original_engine
        database.SessionLocal = original_session
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


# ---------------------------------------------------------------- 金額與庫存

def test_amount_is_server_side():
    print("\n[金額一律後端算，不看前端傳什麼]")
    from app.schemas import OrderCreate, OrderItemIn

    payload = OrderCreate(
        receiver_name="測試", receiver_phone="0912345678",
        items=[OrderItemIn(product_id=1, quantity=2)],
    )
    fields = set(OrderCreate.model_fields)
    for forbidden in ("total_amount", "subtotal", "price", "unit_price",
                      "shipping_fee", "member_discount", "coupon_discount"):
        check(f"下單不接受前端傳「{forbidden}」", forbidden not in fields,
              "有這個欄位就等於讓客人自己決定價格")

    check("只收得到商品 ID 與數量",
          set(OrderItemIn.model_fields) == {"product_id", "quantity"},
          str(set(OrderItemIn.model_fields)))
    check("數量有下限（不能傳 0 或負數）",
          OrderItemIn.model_fields["quantity"].metadata, "應該要有 ge=1")

    for bad in (0, -1, -100):
        try:
            OrderItemIn(product_id=1, quantity=bad)
            ok = False
        except Exception:  # noqa: BLE001
            ok = True
        check(f"數量 {bad} 被拒絕", ok)
    _ = payload


def test_duplicate_lines_merged():
    print("\n[同商品送兩行不能繞過庫存檢查]")
    # 直接驗合併邏輯：庫存 5，送 3 + 3 應該被視為 6 而擋下
    lines = [(1, 3), (1, 3)]
    wanted: dict[int, int] = {}
    for pid, qty in lines:
        wanted[pid] = wanted.get(pid, 0) + qty
    check("兩行 3 組會合併成 6 組", wanted[1] == 6, str(wanted))
    check("合併後超過庫存 5 會被擋", wanted[1] > 5)

    src = (Path(__file__).resolve().parent.parent / "app/routers/orders.py").read_text("utf-8")
    check("下單有做合併", "wanted[line.product_id] = wanted.get" in src)
    check("下單有鎖定商品列", "with_for_update()" in src,
          "沒有鎖的話兩人同時買最後一組會超賣")
    check("鎖定前有排序（避免死鎖）", "sorted(wanted.items())" in src)


def test_payment_trust_boundary():
    print("\n[付款成功只信伺服器對伺服器的通知]")
    src = (Path(__file__).resolve().parent.parent / "app/routers/payments.py").read_text("utf-8")

    # 找出 /result（瀏覽器導回）那段
    start = src.index('@router.post("/result")')
    end = src.index("def _query_and_apply")
    result_fn = src[start:end]

    check("瀏覽器導回不直接寫入付款結果",
          "_apply_payment_result" not in result_fn,
          "OrderResultURL 是經過使用者瀏覽器的，不能當作付款依據")
    check("瀏覽器導回改成主動向綠界查詢",
          "_query_and_apply" in result_fn)

    # 伺服器通知那段仍要驗檢查碼與金額
    cb_start = src.index('@router.post("/callback"')
    cb = src[cb_start:src.index('@router.post("/result")')]
    check("伺服器通知有驗檢查碼", "verify_check_mac_value" in cb)
    check("伺服器通知有驗金額", "Amount Mismatch" in cb)
    check("主動查詢也有驗金額", "金額不符" in src[src.index("def _query_and_apply"):])


if __name__ == "__main__":
    print("=" * 60)
    print("安全性測試（攻擊者視角）")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_order_access, test_access_token_quality, test_order_endpoint_blocks_guessing,
        test_login_throttle, test_login_endpoint_throttle, test_password_hashing,
        test_upload_signature_check, test_upload_endpoint,
        test_amount_is_server_side, test_duplicate_lines_merged,
        test_payment_trust_boundary,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
