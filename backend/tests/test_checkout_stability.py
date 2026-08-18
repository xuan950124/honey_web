"""結帳流程的穩定性測試。

起因是正式站的一次事故：Zeabur 日誌整排
`QueuePool limit of size 5 overflow 10 reached, connection timed out, timeout 30.00`，
`POST /api/orders/quote` 全部 500，購物車的運費永遠停在「計算中…」。

根因是前端兩個 useEffect 互相覆寫付款方式：
「這個配送不支援貨到付款 → 改信用卡」「信用卡被停用 → 改回貨到付款」…
無限迴圈，每一輪都打一次試算 API，幾秒就把資料庫連線吃光。

所以這裡測的不只是「功能對不對」，而是**不要留下無解的組合**——
只要後端保證「每個可選的配送方式底下至少有一種付款方式能用」，
前端就不可能來回打架。

執行：
    cd backend
    python tests/test_checkout_stability.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"

from sqlalchemy import create_engine, event  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, main  # noqa: E402
from app.config import settings as live  # noqa: E402
from app.models import Base, Product, User, UserRole  # noqa: E402
from app.security import create_access_token, hash_password  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent

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
    from fastapi.testclient import TestClient
    return TestClient(main.app, raise_server_exceptions=False), Session, engine


# ---------------------------------------------------------------- 無限迴圈

def test_no_unsolvable_combination():
    """每個可選的配送方式，底下都要至少有一種付款方式能用。

    這是杜絕前端無限迴圈的根本條件。只要有一個組合「配送能選、
    但沒有任何付款方式可用」，自動修正的邏輯就會來回跳。
    """
    print("\n[不能留下無解的配送／付款組合]")
    client, _, _ = make_app()
    original = (live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV)

    scenarios = [
        ("兩邊都測試", "stage", "stage"),
        ("物流正式、金流審核中", "stage", "production"),
        ("兩邊都正式", "production", "production"),
        ("金流正式、物流測試", "production", "stage"),
    ]

    try:
        for label, payment_env, logistics_env in scenarios:
            live.ECPAY_ENV = payment_env
            live.ECPAY_LOGISTICS_ENV = logistics_env
            with client:
                options = client.get("/api/orders/checkout-options").json()

            usable_shipping = [s for s in options["shipping"] if not s["disabled"]]
            check(f"{label}：至少有一種配送可選", len(usable_shipping) > 0,
                  str([s["value"] for s in options["shipping"]]))

            for s in usable_shipping:
                available = [
                    p for p in options["payment"]
                    if not p["disabled"] and (p["value"] != "cod" or s["supports_cod"])
                ]
                check(f"{label}：{s['label']} 有付款方式可選",
                      len(available) > 0,
                      "沒有可用付款方式 → 前端會在自動修正時無限迴圈")

            # 被停用的一定要說明原因，不然畫面上只有一個按不動的選項
            for s in options["shipping"]:
                if s["disabled"]:
                    check(f"{label}：{s['label']} 停用時有說明",
                          bool(s["disabled_reason"]), str(s))
    finally:
        live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV = original


def test_cod_only_disables_post():
    """只開放貨到付款時，不支援貨到付款的配送要整個停掉。"""
    print("\n[只開放貨到付款時，中華郵政要被停用]")
    client, _, _ = make_app()
    original = (live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV)
    live.ECPAY_ENV = "stage"
    live.ECPAY_LOGISTICS_ENV = "production"

    try:
        with client:
            options = client.get("/api/orders/checkout-options").json()
        by_value = {s["value"]: s for s in options["shipping"]}

        check("中華郵政被停用", by_value["home_post"]["disabled"] is True,
              "它不支援貨到付款，留著就是一個選了會卡死的選項")
        check("停用原因講得清楚",
              "貨到付款" in (by_value["home_post"]["disabled_reason"] or ""),
              str(by_value["home_post"]["disabled_reason"]))
        check("被停用的不會被標成最省運費",
              by_value["home_post"]["is_cheapest"] is False)

        for value in ("cvs_hilife_c2c", "cvs_unimart_c2c", "cvs_fami_c2c", "home_tcat"):
            check(f"{by_value[value]['label']} 仍可選", by_value[value]["disabled"] is False)
    finally:
        live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV = original


def test_query_count():
    """一次請求只查一次設定。

    之前每算一次運費就查一次資料庫，五種配送算三輪＝十幾次查詢。
    平常看不出來，同時有幾個人在結帳就把連線池吃光了。
    """
    print("\n[一次請求只查一次設定]")
    client, Session, engine = make_app()

    counts = {"n": 0}

    @event.listens_for(engine, "before_cursor_execute")
    def _count(conn, cursor, statement, parameters, context, executemany):
        if "site_settings" in statement:
            counts["n"] += 1

    db = Session()
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    db.close()

    with client:
        counts["n"] = 0
        client.get("/api/orders/checkout-options")
        check(f"checkout-options 只查 1 次（實際 {counts['n']} 次）", counts["n"] <= 1)

        counts["n"] = 0
        client.post("/api/orders/quote", json={
            "subtotal": 680, "shipping_method": "cvs_unimart_c2c",
            "payment_method": "cod", "temperature": "0001",
        })
        check(f"quote 只查 1 次（實際 {counts['n']} 次）", counts["n"] <= 1)


def test_pool_settings():
    print("\n[連線池設定]")
    check("池子大小可設定", hasattr(live, "DB_POOL_SIZE"))
    check("池子不會太小", live.DB_POOL_SIZE >= 10, str(live.DB_POOL_SIZE))
    check("逾時夠短（要快點失敗）", live.DB_POOL_TIMEOUT <= 10, str(live.DB_POOL_TIMEOUT))
    check("總連線數不會超過資料庫上限",
          live.DB_POOL_SIZE + live.DB_MAX_OVERFLOW <= 100,
          str(live.DB_POOL_SIZE + live.DB_MAX_OVERFLOW))

    src = (ROOT / "backend/app/main.py").read_text("utf-8")
    check("連線池耗盡有專屬的中文訊息", "伺服器忙碌中" in src)
    check("訊息會提示可能是重複送出請求", "重複送出請求" in src)


# ---------------------------------------------------------------- 門市

def test_store_must_match_chain():
    print("\n[門市必須屬於選的那家超商]")
    client, Session, _ = make_app()
    db = Session()
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    db.close()

    base = {
        "receiver_name": "測試", "receiver_phone": "0912345678",
        "items": [{"product_id": 1, "quantity": 1}],
        "payment_method": "cod",
        "cvs_store_id": "253417", "cvs_store_name": "華新一門市",
    }

    with client:
        # 7-11 的門市配萊爾富的配送方式 → 要被擋
        r = client.post("/api/orders", json={
            **base, "shipping_method": "cvs_hilife_c2c", "cvs_sub_type": "UNIMARTC2C",
        })
        check("7-11 門市配萊爾富被擋", r.status_code == 400, str(r.status_code))
        check("錯誤訊息叫人重選門市",
              "重新選擇門市" in r.json().get("detail", ""), str(r.json().get("detail")))

        # 對得起來就放行
        r = client.post("/api/orders", json={
            **base, "shipping_method": "cvs_unimart_c2c", "cvs_sub_type": "UNIMARTC2C",
        })
        check("門市與配送相符可以下單", r.status_code == 201, str(r.status_code)[:200])

        # 舊版前端沒帶 cvs_sub_type 時不要硬擋（不然一部署就全掛）
        r = client.post("/api/orders", json={
            **base, "shipping_method": "cvs_unimart_c2c",
        })
        check("沒帶超商類型時仍可下單（相容舊前端）",
              r.status_code == 201, str(r.status_code)[:200])


# ---------------------------------------------------------------- 可否購買

def test_purchasable_flag():
    print("\n[看得到但不能買]")
    client, Session, _ = make_app()

    db = Session()
    db.add(Product(id=1, name="試賣中的蜜", price=500, stock=10,
                   is_active=True, is_purchasable=False,
                   unavailable_note="新品試作中，預計 10 月開賣"))
    db.add(Product(id=2, name="正常的蜜", price=680, stock=10))
    staff = User(email="s@x.com", hashed_password=hash_password("x"),
                 name="員工", role=UserRole.staff)
    member = User(email="m@x.com", hashed_password=hash_password("x"),
                  name="會員", role=UserRole.member)
    db.add_all([staff, member])
    db.commit()
    staff_token = create_access_token(staff.id)
    member_token = create_access_token(member.id)
    db.close()

    order = {
        "receiver_name": "測試", "receiver_phone": "0912345678",
        "items": [{"product_id": 1, "quantity": 1}],
        "shipping_method": "cvs_unimart_c2c", "payment_method": "cod",
        "cvs_store_id": "991182", "cvs_store_name": "測試門市",
    }

    with client:
        # 前台仍然看得到（這就是重點：看得到，只是不能買）
        products = client.get("/api/products").json()
        ids = {p["id"] for p in products}
        check("不開放購買的商品前台仍看得到", 1 in ids, str(ids))
        item = next(p for p in products if p["id"] == 1)
        check("有回傳 is_purchasable", item["is_purchasable"] is False)
        check("有回傳說明文字",
              item["unavailable_note"] == "新品試作中，預計 10 月開賣",
              str(item["unavailable_note"]))

        # 訪客不能買
        r = client.post("/api/orders", json=order)
        check("訪客買不到", r.status_code == 400, str(r.status_code))
        check("錯誤訊息帶上店家寫的原因",
              "10 月開賣" in r.json().get("detail", ""), str(r.json().get("detail")))

        # 一般會員也不能買
        r = client.post("/api/orders", json=order,
                        headers={"Authorization": f"Bearer {member_token}"})
        check("一般會員買不到", r.status_code == 400, str(r.status_code))

        # 工作人員可以買 —— 這正是這個開關的用途
        r = client.post("/api/orders", json=order,
                        headers={"Authorization": f"Bearer {staff_token}"})
        check("工作人員買得到（用來測流程）", r.status_code == 201, str(r.status_code)[:200])

        # 正常商品不受影響
        r = client.post("/api/orders", json={**order, "items": [{"product_id": 2, "quantity": 1}]})
        check("正常商品照樣買得到", r.status_code == 201, str(r.status_code)[:200])


def test_purchasable_defaults():
    print("\n[預設值與相容性]")
    from app.schemas import ProductIn, ProductOut

    check("新商品預設可以買",
          ProductIn.model_fields["is_purchasable"].default is True)
    check("回傳格式也預設可以買",
          ProductOut.model_fields["is_purchasable"].default is True,
          "舊資料沒有這個欄位時不能變成不能買")
    check("資料表有這個欄位", "is_purchasable" in Product.__table__.c)
    check("資料表欄位預設為 True",
          Product.__table__.c.is_purchasable.default.arg is True)
    check("說明欄位也在", "unavailable_note" in Product.__table__.c)


# ---------------------------------------------------------------- 前端接線

def test_frontend_wiring():
    print("\n[前端有接上]")
    src = ROOT / "frontend/src"

    cart = (src / "pages/Cart.jsx").read_text("utf-8")
    # 使用者自己點選（onChange）當然可以改；要防的是「程式自動改」有兩處以上，
    # 那才會出現 A 改成甲、B 改回乙、A 又改成甲的無限迴圈。
    auto_setters = [
        line for line in cart.splitlines()
        if "setPaymentMethod(" in line and "onChange" not in line
    ]
    check("自動修正付款方式只有一處", len(auto_setters) == 1,
          f"有 {len(auto_setters)} 處：{[l.strip() for l in auto_setters]}")

    auto_shipping = [
        line for line in cart.splitlines()
        if "setShippingMethod(" in line and "onChange" not in line
    ]
    check("自動修正配送方式只有一處", len(auto_shipping) == 1,
          f"有 {len(auto_shipping)} 處：{[l.strip() for l in auto_shipping]}")
    check("用單一清單算出可用付款方式", "availablePayments" in cart)
    check("試算有防抖", "setTimeout(" in cart and "250" in cart)
    check("試算失敗會顯示錯誤", "quoteError" in cart)
    check("試算失敗可以重試", "quoteRetry" in cart)
    check("試算失敗時不讓送出", "Boolean(quoteError)" in cart)
    check("換配送方式會清掉門市", "setStore({})" in cart)
    check("配送方式可被後端停用", "s.disabled" in cart)

    picker = (src / "components/StorePicker.jsx").read_text("utf-8")
    check("會偵測視窗被關閉", "popup.closed" in picker or "closed" in picker)
    check("有輪詢", "setInterval" in picker)
    check("離開時會清掉輪詢", "clearInterval" in picker)
    check("可以主動取消等待", "取消，我不選了" in picker)
    check("會帶回超商類型", "cvs_sub_type" in picker)

    detail = (src / "pages/ProductDetail.jsx").read_text("utf-8")
    check("商品頁認得不開放購買", "notForSale" in detail)
    check("工作人員看得到提醒", "不開放購買" in detail)

    card = (src / "components/ProductCard.jsx").read_text("utf-8")
    check("列表有「尚未開賣」標籤", "尚未開賣" in card)

    form = (src / "pages/admin/AdminProductForm.jsx").read_text("utf-8")
    check("後台有開放購買的勾選框", "is_purchasable" in form)
    check("後台說明兩個開關的差別", "上架中" in form and "開放購買" in form)

    cart_ctx = (src / "context/CartContext.jsx").read_text("utf-8")
    check("購物車會清掉不能買的商品", "is_purchasable === false" in cart_ctx)
    check("工作人員的購物車不清", "allowUnpurchasable" in cart_ctx)


if __name__ == "__main__":
    print("=" * 60)
    print("結帳流程穩定性測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_no_unsolvable_combination, test_cod_only_disables_post,
        test_query_count, test_pool_settings,
        test_store_must_match_chain,
        test_purchasable_flag, test_purchasable_defaults,
        test_frontend_wiring,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
