"""LINE 機器人：簽章驗證、操作權限、以及「按了就會花錢」的防護。

## 為什麼這一份要特別小心

webhook 網址是**公開的**，任何人都能對它發 POST。
而「建立物流單」按鈕按下去會真的向綠界建單，
**超商運費是從店家的綠界餘額先扣的** —— 等於這是一個花錢的遙控器。

所以有兩道關卡，而且兩道都要測：

1. **簽章** 證明「這包資料來自 LINE」
2. **白名單** 證明「這是老闆按的」

只有第 1 道的話，任何人加好友都能叫你的系統去建單扣運費。

執行：
    cd backend
    python tests/test_line_bot.py
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, line, main  # noqa: E402
from app.config import settings as live  # noqa: E402
from app.models import (  # noqa: E402
    Base, LogisticsStatus, Order, OrderItem, OrderStatus, PaymentMethod,
    PaymentStatus, Product, ShippingMethod, User, UserRole,
)
from app.security import create_access_token, hash_password  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
SECRET = "test-channel-secret"
BOSS = "U_boss_0000000000000000000000000"

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


def sign(body: bytes) -> str:
    return base64.b64encode(
        hmac.new(SECRET.encode(), body, hashlib.sha256).digest()
    ).decode()


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
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=5))
    order = Order(
        id=7, order_no="20260822700", receiver_name="買家", receiver_phone="0912345678",
        receiver_address="基隆市七堵區華新一路89-6號",
        subtotal=680, shipping_fee=70, total_amount=750,
        status=OrderStatus.paid, payment_method=PaymentMethod.credit,
        payment_status=PaymentStatus.paid, paid_at=datetime.now(),
        shipping_method=ShippingMethod.cvs_unimart_c2c,
        cvs_store_id="253417", cvs_store_name="華新一門市",
        logistics_status=LogisticsStatus.none,
    )
    db.add(order)
    db.flush()
    db.add(OrderItem(order_id=7, product_id=1, product_name="龍眼蜜",
                     unit_price=680, quantity=1))
    db.commit()
    db.close()

    from fastapi.testclient import TestClient
    return (TestClient(main.app, raise_server_exceptions=False), Session,
            {"Authorization": f"Bearer {create_access_token(1)}"},
            {"Authorization": f"Bearer {create_access_token(2)}"})


def event(body: dict) -> tuple[bytes, dict]:
    raw = json.dumps(body).encode()
    return raw, {"X-Line-Signature": sign(raw)}


# ---------------------------------------------------------------- 簽章

def test_signature():
    """簽章驗證是第一道關卡：證明這包資料真的來自 LINE。"""
    print("\n[簽章驗證]")
    original = live.LINE_CHANNEL_SECRET
    live.LINE_CHANNEL_SECRET = SECRET
    try:
        body = b'{"events":[]}'
        check("正確的簽章通過", line.verify_signature(body, sign(body)))
        check("亂寫的簽章擋掉", line.verify_signature(body, "not-a-signature") is False)
        check("空簽章擋掉", line.verify_signature(body, "") is False)
        check("body 被改過就擋掉",
              line.verify_signature(b'{"events":[{"evil":1}]}', sign(body)) is False,
              "簽的是整包內容，改一個字元就對不上")

        live.LINE_CHANNEL_SECRET = ""
        check("沒設定 secret 時一律不通過",
              line.verify_signature(body, sign(body)) is False,
              "驗不了簽章就不該開放 webhook —— 那等於誰都能叫你的系統做事")
    finally:
        live.LINE_CHANNEL_SECRET = original


def test_webhook_rejects_forgery():
    print("\n[webhook 擋掉偽造的請求]")
    client, _, _, _ = make_app()
    original = (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS)
    live.LINE_CHANNEL_SECRET = SECRET
    live.LINE_ADMIN_USER_IDS = BOSS

    try:
        raw, headers = event({"events": []})
        with client:
            r = client.post("/api/line/webhook", content=raw)
            check("沒帶簽章回 400", r.status_code == 400, str(r.status_code))

            r = client.post("/api/line/webhook", content=raw,
                            headers={"X-Line-Signature": "forged"})
            check("簽章錯誤回 400", r.status_code == 400, str(r.status_code))

            r = client.post("/api/line/webhook", content=raw, headers=headers)
            check("簽章正確回 200", r.status_code == 200, str(r.status_code))

            # LINE 的規則：沒有回 200 會累積失敗次數，太多次就自動停用 webhook。
            # 所以內容有問題也要回 200，用訊息告訴使用者而不是用狀態碼。
            broken = b"not json at all"
            r = client.post("/api/line/webhook", content=broken,
                            headers={"X-Line-Signature": sign(broken)})
            check("內容壞掉仍回 200", r.status_code == 200,
                  "回非 200 會被 LINE 記失敗，累積太多次 webhook 會被停用")
    finally:
        live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS = original


# ---------------------------------------------------------------- 權限

def test_only_admin_can_ship():
    """簽章只證明「來自 LINE」，不代表「是老闆按的」。

    任何人加官方帳號好友都能送 postback 進來 —— 少了白名單這一道，
    陌生人就能叫你的系統去綠界建單，而運費是從你的餘額先扣的。
    """
    print("\n[只有店家本人能建物流單]")
    client, Session, _, _ = make_app()
    original = (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
                live.LINE_CHANNEL_ACCESS_TOKEN)
    live.LINE_CHANNEL_SECRET = SECRET
    live.LINE_ADMIN_USER_IDS = BOSS
    # 沒有 token 就不會真的打 LINE 的 API（測試不該送出真訊息）
    live.LINE_CHANNEL_ACCESS_TOKEN = ""

    try:
        check("白名單認得出自己人", line.is_admin(BOSS) is True)
        check("陌生人不算", line.is_admin("U_stranger") is False)
        check("拿不到 userId 也不算", line.is_admin(None) is False)

        live.LINE_ADMIN_USER_IDS = ""
        check("沒設白名單時誰都不算",
              line.is_admin(BOSS) is False,
              "空的白名單要當成「誰都不行」，不能當成「誰都可以」")
        live.LINE_ADMIN_USER_IDS = BOSS

        raw, headers = event({"events": [{
            "type": "postback", "replyToken": "tok",
            "source": {"userId": "U_stranger"},
            "postback": {"data": "act=ship&order=7"},
        }]})
        with client:
            r = client.post("/api/line/webhook", content=raw, headers=headers)
            check("陌生人按按鈕回 200（不能洩漏系統有沒有做事）", r.status_code == 200)

        db = Session()
        order = db.get(Order, 7)
        check("陌生人按了不會建單",
              order.allpay_logistics_id is None,
              "建單會從綠界餘額扣運費，這是花錢的操作")
        check("物流狀態沒被動過", order.logistics_status == LogisticsStatus.none)
        db.close()
    finally:
        (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
         live.LINE_CHANNEL_ACCESS_TOKEN) = original


def test_duplicate_press_does_not_rebuild():
    """同一顆按鈕按兩次不能建兩次單 —— 那會多扣一次運費。"""
    print("\n[重複按不會重複建單]")
    client, Session, _, _ = make_app()
    original = (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
                live.LINE_CHANNEL_ACCESS_TOKEN)
    live.LINE_CHANNEL_SECRET = SECRET
    live.LINE_ADMIN_USER_IDS = BOSS
    live.LINE_CHANNEL_ACCESS_TOKEN = ""

    try:
        db = Session()
        order = db.get(Order, 7)
        order.allpay_logistics_id = "49794078"
        order.cvs_payment_no = "E8691558"
        order.logistics_status = LogisticsStatus.created
        db.commit()
        db.close()

        raw, headers = event({"events": [{
            "type": "postback", "replyToken": "tok",
            "source": {"userId": BOSS},
            "postback": {"data": "act=ship&order=7"},
        }]})
        with client:
            r = client.post("/api/line/webhook", content=raw, headers=headers)
            check("回 200", r.status_code == 200)

        db = Session()
        order = db.get(Order, 7)
        check("物流編號沒有被覆蓋", order.allpay_logistics_id == "49794078",
              "重複建單等於多付一次運費")
        db.close()
    finally:
        (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
         live.LINE_CHANNEL_ACCESS_TOKEN) = original


# ---------------------------------------------------------------- 訊息

def test_message_shapes():
    print("\n[訊息內容]")
    client, Session, _, _ = make_app()
    db = Session()
    order = db.get(Order, 7)
    order.shipping_method_label = "7-ELEVEN 超商取貨"
    order.payment_method_label = "信用卡"

    card = line.order_card(order, "https://huanglong-honey.com")
    body = json.dumps(card, ensure_ascii=False)

    check("是 Flex 訊息", card["type"] == "flex")
    check("有 altText（通知列與舊版 LINE 會顯示這個）", bool(card.get("altText")))
    check("altText 有訂單編號", "20260822700" in card["altText"])
    check("有建立物流單的按鈕", '"act=ship&order=7"' in body)
    check("按鈕是 postback 不是 uri", '"type": "postback"' in body,
          "uri 會把人丟到瀏覽器再登入一次，就失去在 LINE 裡處理完的意義")
    check("有門市名稱", "華新一門市" in body)
    check("有商品明細", "龍眼蜜" in body)

    order.allpay_logistics_id = "49794078"
    order.cvs_payment_no = "E8691558"
    done = json.dumps(line.order_card(order, "https://x.com"), ensure_ascii=False)
    check("已建單就不再給按鈕", "act=ship" not in done,
          "留著按鈕只會讓人重複按，然後多扣一次運費")
    check("已建單改顯示寄件代碼", "E8691558" in done)

    code = line.shipping_code_card(order, {
        "cvs_payment_no": "E8691558", "cvs_validation_no": "4533",
    })
    code_body = json.dumps(code, ensure_ascii=False)
    check("寄件代碼卡片有代碼", "E8691558" in code_body)
    check("有驗證碼", "4533" in code_body)
    check("代碼字級夠大", '"size": "3xl"' in code_body,
          "這是要站在超商機台前照著打的東西，小字很痛苦")
    db.close()


def test_status_endpoint():
    print("\n[設定狀態]")
    client, _, staff, member = make_app()
    original = (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
                live.LINE_CHANNEL_ACCESS_TOKEN)
    live.LINE_CHANNEL_SECRET = SECRET
    live.LINE_ADMIN_USER_IDS = BOSS
    live.LINE_CHANNEL_ACCESS_TOKEN = "token"

    try:
        with client:
            r = client.get("/api/line/status", headers=staff)
            check("工作人員看得到狀態", r.status_code == 200, str(r.status_code))
            data = r.json()
            check("三項齊全時 ready", data["ready"] is True, str(data))
            check("有給 webhook 網址（要貼到 LINE 後台）",
                  data["webhook_url"].endswith("/api/line/webhook"))
            check("不回傳任何金鑰內容",
                  SECRET not in r.text and "token" not in r.json().values(),
                  "狀態端點洩漏金鑰的話，等於後台被看一眼就全毀")

            for label, headers in (("未登入", {}), ("一般會員", member)):
                r = client.get("/api/line/status", headers=headers)
                check(f"{label} 看不到", r.status_code in (401, 403), str(r.status_code))

            live.LINE_CHANNEL_SECRET = ""
            check("少一項就不算 ready",
                  client.get("/api/line/status", headers=staff).json()["ready"] is False,
                  "缺簽章驗證還開著 webhook 是危險的，寧可整個關閉")
    finally:
        (live.LINE_CHANNEL_SECRET, live.LINE_ADMIN_USER_IDS,
         live.LINE_CHANNEL_ACCESS_TOKEN) = original


def test_notify_never_breaks_checkout():
    """通知送不出去是小事，讓客人結不了帳是大事。"""
    print("\n[通知失敗不能影響下單]")
    original = live.LINE_CHANNEL_ACCESS_TOKEN
    live.LINE_CHANNEL_ACCESS_TOKEN = ""
    try:
        client, Session, _, _ = make_app()
        db = Session()
        order = db.get(Order, 7)
        order.shipping_method_label = "7-ELEVEN 超商取貨"
        order.payment_method_label = "信用卡"
        try:
            line.notify_new_order(order)
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        check("沒設定 token 時安靜跳過", ok, "不能因為 LINE 沒設定就讓下單失敗")
        db.close()
    finally:
        live.LINE_CHANNEL_ACCESS_TOKEN = original

    src = (ROOT / "backend/app/line.py").read_text("utf-8")
    check("推播失敗只記錄不拋出", "except Exception" in src and "log.warning" in src)

    orders_py = (ROOT / "backend/app/routers/orders.py").read_text("utf-8")
    payments_py = (ROOT / "backend/app/routers/payments.py").read_text("utf-8")
    check("貨到付款下單時通知", "notify_new_order(" in orders_py)
    check("線上付款收到錢才通知", "notify_new_order(" in payments_py,
          "下單就通知的話，沒付款的訂單也會叫你出貨")
    # `line` 在 orders.py 裡是「訂單的一行」的區域變數，
    # 用 `from .. import line` 會被蓋掉（踩過這個坑，下單直接 500）
    check("orders.py 直接 import 函式而不是模組",
          "from ..line import notify_new_order" in orders_py,
          "模組名會被區域變數 line 蓋掉")


def test_shared_logistics_code():
    """LINE 與後台必須用同一份建單邏輯。

    複製一份出去的話，改了驗證規則只會改到一邊，
    另一邊就會靜靜地建出爛單 —— 而且是花了運費才發現。
    """
    print("\n[建單邏輯只有一份]")
    logistics = (ROOT / "backend/app/routers/logistics.py").read_text("utf-8")
    bot = (ROOT / "backend/app/routers/line_bot.py").read_text("utf-8")

    check("抽出了共用函式", "def build_logistics_order(" in logistics)
    check("後台路由呼叫它", "return build_logistics_order(db, order_id)" in logistics)
    check("LINE 也呼叫同一個", "build_logistics_order(db, order_id)" in bot)
    check("LINE 沒有自己組綠界參數",
          "with_check_mac_value" not in bot and "Express/Create" not in bot,
          "自己組一份的話，兩邊的規則遲早會不一樣")


if __name__ == "__main__":
    print("=" * 60)
    print("LINE 機器人測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_signature, test_webhook_rejects_forgery, test_only_admin_can_ship,
        test_duplicate_press_does_not_rebuild, test_message_shapes,
        test_status_endpoint, test_notify_never_breaks_checkout,
        test_shared_logistics_code,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
