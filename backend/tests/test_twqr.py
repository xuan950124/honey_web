"""行動支付（TWQR）的測試。

綠界的規定（全方位金流技術文件「歐付寶TWQR行動支付」）：
  - ChoosePayment=TWQR
  - 金額不可小於 6 元或大於 49,999 元
  - 退款在「歐付寶廠商後台」或「歐付寶 APP」，綠界沒有 API

這裡鎖住的是：
  1. 結帳頁看得到、說明寫對（列出能用的 App、LINE Pay 不適用）
  2. 金額超出範圍時，下單、換付款方式、前往付款三個地方都擋得住
  3. 店家在後台關掉時，直接打 API 也不收
  4. 送去綠界的參數對、付款通知回來會變成已付款
  5. 退款說明叫人去歐付寶，不會出現綠界的退刷按鈕

執行：
    cd backend
    python tests/test_twqr.py
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import datetime
from html import unescape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, main, refunds  # noqa: E402
from app.models import (  # noqa: E402
    PAYMENT_AMOUNT_LIMITS, PAYMENT_MAP, Base, Order, OrderItem, OrderStatus, PaymentMethod,
    PaymentStatus, Product, ShippingMethod, SiteSetting,
)
from app.shipping import payment_amount_error  # noqa: E402

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
    db = Session()
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=50))
    db.add(Product(id=2, name="綜合蜂蜜 12 入組", price=6000, stock=50))
    db.commit()
    db.close()
    from fastapi.testclient import TestClient
    return TestClient(main.app, raise_server_exceptions=False), Session


def order_payload(method: str, product_id: int = 1, quantity: int = 1) -> dict:
    # 宅配（黑貓）：不用選門市，超商取貨的 20,000 元上限也不會先擋掉
    return {
        "receiver_name": "測試", "receiver_phone": "0912345678",
        "receiver_address": "基隆市七堵區華新一路89號", "receiver_zipcode": "206",
        "items": [{"product_id": product_id, "quantity": quantity}],
        "shipping_method": "home_tcat", "payment_method": method,
    }


def add_order(Session, order_no: str, total: float, method=PaymentMethod.twqr, **kw) -> Order:
    db = Session()
    fields = dict(
        order_no=order_no, access_token="tok" + order_no[-6:], receiver_name="測試",
        receiver_phone="0912345678", receiver_address="基隆市七堵區華新一路89號",
        subtotal=total, shipping_fee=0, total_amount=total, status=OrderStatus.pending,
        shipping_method=ShippingMethod.home_tcat, payment_method=method,
        payment_status=PaymentStatus.unpaid,
    )
    fields.update(kw)
    order = Order(**fields)
    db.add(order)
    db.flush()
    db.add(OrderItem(order_id=order.id, product_id=1, product_name="龍眼蜜",
                     unit_price=total, quantity=1))
    db.commit()
    db.refresh(order)
    db.expunge(order)
    db.close()
    return order


# ---------------------------------------------------------------- 對應表與金額

def test_maps_and_limits():
    print("\n[行動支付的設定]")
    check("有 twqr 這個付款方式", PaymentMethod.twqr.value == "twqr")
    check("送綠界用 ChoosePayment=TWQR", PAYMENT_MAP["twqr"][0] == "TWQR", str(PAYMENT_MAP["twqr"]))
    check("顯示名稱是「行動支付」", PAYMENT_MAP["twqr"][1] == "行動支付")
    check("金額限制是 6～49,999 元（綠界規定）",
          PAYMENT_AMOUNT_LIMITS.get("twqr") == (6, 49_999), str(PAYMENT_AMOUNT_LIMITS))
    check("排在信用卡後面（結帳頁的順序）",
          list(PAYMENT_MAP).index("twqr") == list(PAYMENT_MAP).index("credit") + 1,
          str(list(PAYMENT_MAP)))

    check("5 元太少", payment_amount_error("twqr", 5) is not None)
    check("6 元可以", payment_amount_error("twqr", 6) is None)
    check("49,999 元可以", payment_amount_error("twqr", 49_999) is None)
    over = payment_amount_error(PaymentMethod.twqr, 50_000)
    check("50,000 元超過", over is not None and "49,999" in over, str(over))
    check("超過時的說明有寫這筆多少錢", over is not None and "50,000" in over, str(over))
    check("其他付款方式沒有這個限制", payment_amount_error("credit", 999_999) is None)
    check("四捨五入跟送給綠界的金額一致", payment_amount_error("twqr", 49_999.4) is None)


# ---------------------------------------------------------------- 結帳頁

def test_checkout_options():
    print("\n[結帳頁的選項]")
    client, Session = make_app()
    with client:
        data = client.get("/api/orders/checkout-options").json()
        twqr = next((p for p in data["payment"] if p["value"] == "twqr"), None)
        check("結帳頁有行動支付", twqr is not None)
        note = (twqr or {}).get("note") or ""
        for app_name in ("街口", "全支付", "悠遊付", "icash Pay", "台灣Pay", "銀行 App"):
            check(f"說明有列出 {app_name}", app_name in note, note)
        check("說明有講 LINE Pay 不適用", "LINE Pay 目前不適用" in note, note)
        check("帶著金額限制給前端",
              twqr and twqr["min_amount"] == 6 and twqr["max_amount"] == 49_999, str(twqr))
        check("其他付款方式沒有金額限制",
              all(p["max_amount"] is None for p in data["payment"] if p["value"] != "twqr"))
        check("沒關掉時是開放的", twqr and twqr["offered"] and not twqr["disabled"], str(twqr))
        check("回應有 cod_only（審核中說明靠它，不靠「有沒有選項停用」）",
              data.get("cod_only") is False, str(data.get("cod_only")))

        # 店家在後台只留信用卡與貨到付款
        db = Session()
        db.add(SiteSetting(key="payment_methods_enabled", value="credit,cod"))
        db.commit()
        db.close()
        data = client.get("/api/orders/checkout-options").json()
        twqr = next(p for p in data["payment"] if p["value"] == "twqr")
        check("店家關掉時標成不開放", twqr["offered"] is False and twqr["disabled"] is True, str(twqr))
        check("店家關掉不等於審核中", data.get("cod_only") is False)

        r = client.post("/api/orders", json=order_payload("twqr"))
        check("店家關掉的付款方式直接打 API 也不收", r.status_code == 400, str(r.status_code))
        check("錯誤訊息講「未開放」", "未開放" in r.json().get("detail", ""), str(r.json()))
        r = client.post("/api/orders", json=order_payload("credit"))
        check("有開放的照樣能下單", r.status_code == 201, str(r.status_code))


# ---------------------------------------------------------------- 下單與前往付款

def test_create_and_checkout():
    print("\n[下單、前往付款]")
    client, Session = make_app()
    with client:
        r = client.post("/api/orders", json=order_payload("twqr", product_id=1, quantity=2))
        check("一般金額可以用行動支付下單", r.status_code == 201, str(r.status_code) + r.text[:200])
        body = r.json() if r.status_code == 201 else {}
        order = body.get("order") or {}
        check("訂單記成行動支付", order.get("payment_method") == "twqr")
        check("付款方式標籤是「行動支付」", order.get("payment_method_label") == "行動支付")
        url = body.get("payment_url") or ""
        check("有前往付款的網址", "/api/payments/" in url, url)

        if url:
            path = url[url.index("/api/payments/"):]
            page = client.get(path)
            html = unescape(page.text)
            check("前往付款頁正常", page.status_code == 200, str(page.status_code))
            check("送給綠界 ChoosePayment=TWQR", 'name="ChoosePayment" value="TWQR"' in html,
                  html[:300])
            check("沒有 ATM 的繳費期限參數", 'name="ExpireDate"' not in html)
            check("沒有超商代碼的期限參數", 'name="StoreExpireDate"' not in html)

        # 6,000 × 9 = 54,000 元
        r = client.post("/api/orders", json=order_payload("twqr", product_id=2, quantity=9))
        check("超過 49,999 元不能用行動支付下單", r.status_code == 400, str(r.status_code))
        check("錯誤訊息講上限", "49,999" in r.json().get("detail", ""), str(r.json()))
        db = Session()
        stock = db.get(Product, 2).stock
        db.close()
        check("被擋下來的訂單沒有扣庫存", stock == 50, str(stock))

        r = client.post("/api/orders", json=order_payload("credit", product_id=2, quantity=9))
        check("同樣金額用信用卡可以", r.status_code == 201, str(r.status_code))

        # 已經存在的超額行動支付訂單（例如資料被手動改過）：前往付款時最後一道擋下來
        big = add_order(Session, "20261013000000901", 60_000)
        page = client.get(f"/api/payments/{big.order_no}/checkout?t={big.access_token}")
        check("超額訂單不會被送去綠界", page.status_code == 400, str(page.status_code))
        check("說明頁講上限與怎麼換", "49,999" in page.text and "改用其他付款方式" in page.text,
              page.text[-400:])

        # 店家在後台先把行動支付關掉（例如出問題時）：還沒付款的行動支付訂單也不再送去綠界
        waiting = add_order(Session, "20261013000000902", 1_510)
        db = Session()
        db.add(SiteSetting(key="payment_methods_enabled", value="credit,atm,cvs_code,cod"))
        db.commit()
        db.close()
        page = client.get(f"/api/payments/{waiting.order_no}/checkout?t={waiting.access_token}")
        check("店家關掉後不會再被送去綠界", page.status_code == 400, str(page.status_code))
        check("說明頁請客人換一種付款方式", "未開放" in page.text and "改用其他付款方式" in page.text,
              page.text[-400:])
        credit = add_order(Session, "20261013000000903", 1_510, method=PaymentMethod.credit)
        page = client.get(f"/api/payments/{credit.order_no}/checkout?t={credit.access_token}")
        check("其他還開著的付款方式照常前往付款", page.status_code == 200, str(page.status_code))


# ---------------------------------------------------------------- 換付款方式

def test_change_payment_method():
    print("\n[換成行動支付]")
    from app.routers.orders import change_payment_method
    from app.schemas import PaymentMethodUpdate

    client, Session = make_app()
    db = Session()
    db.add(SiteSetting(key="cod_fee", value="30"))
    db.commit()
    db.close()

    def attempt(order: Order, method: PaymentMethod):
        db = Session()
        try:
            return change_payment_method(
                order.order_no, PaymentMethodUpdate(payment_method=method),
                t=order.access_token, db=db, user=None,
            ), None
        except HTTPException as exc:
            return None, exc.detail
        finally:
            db.close()

    small = add_order(Session, "20261013000000911", 1_070, method=PaymentMethod.credit,
                      payment_status=PaymentStatus.failed)
    result, err = attempt(small, PaymentMethod.twqr)
    check("信用卡失敗可以改用行動支付", err is None, str(err))
    check("付款方式真的換了", result is not None and result.payment_method == PaymentMethod.twqr)

    big = add_order(Session, "20261013000000912", 60_000, method=PaymentMethod.credit)
    _, err = attempt(big, PaymentMethod.twqr)
    check("超過上限不能換成行動支付", err is not None and "49,999" in str(err), str(err))

    # 貨到付款含 30 元手續費共 50,020 元；換成行動支付時手續費拿掉，剩 49,990 元 → 可以
    cod = add_order(Session, "20261013000000913", 50_020, method=PaymentMethod.cod,
                    shipping_fee=30)
    result, err = attempt(cod, PaymentMethod.twqr)
    check("看的是拿掉手續費之後的金額", err is None, str(err))
    check("金額重算成 49,990", result is not None and float(result.total_amount) == 49_990,
          str(result and result.total_amount))

    db = Session()
    db.add(SiteSetting(key="payment_methods_enabled", value="credit,atm,cvs_code,cod"))
    db.commit()
    db.close()
    other = add_order(Session, "20261013000000914", 1_070, method=PaymentMethod.credit)
    _, err = attempt(other, PaymentMethod.twqr)
    check("店家關掉的付款方式不能換過去", err is not None and "未開放" in str(err), str(err))


# ---------------------------------------------------------------- 付款通知

def test_payment_result():
    print("\n[付款通知]")
    from app.routers.payments import _apply_payment_result, _build_checkout_params

    client, Session = make_app()
    order = add_order(Session, "20261013000000921", 1_510)
    db = Session()
    order = db.query(Order).filter(Order.order_no == order.order_no).first()
    params = _build_checkout_params(order, order.order_no)
    check("參數的 ChoosePayment 是 TWQR", params["ChoosePayment"] == "TWQR", str(params))
    check("金額是整數", params["TotalAmount"] == 1_510, str(params["TotalAmount"]))

    _apply_payment_result(db, order, {
        "RtnCode": "1", "RtnMsg": "交易成功", "TradeNo": "2610131234567890",
        "PaymentType": "TWQR_OPAY", "TradeAmt": "1510",
    })
    db.commit()
    check("RtnCode=1 變成已付款", order.payment_status == PaymentStatus.paid,
          str(order.payment_status))
    check("訂單狀態跟著變成已付款", order.status == OrderStatus.paid, str(order.status))
    check("記下綠界交易編號", order.ecpay_trade_no == "2610131234567890")
    check("記下實際的付款類型", order.payment_type == "TWQR_OPAY", str(order.payment_type))

    failed = add_order(Session, "20261013000000922", 1_510)
    failed = db.query(Order).filter(Order.order_no == failed.order_no).first()
    _apply_payment_result(db, failed, {"RtnCode": "10300066", "RtnMsg": "交易付款結果待確認中"})
    db.commit()
    check("不是 1 就不算付款成功", failed.payment_status != PaymentStatus.paid,
          str(failed.payment_status))
    db.close()


# ---------------------------------------------------------------- 退款

def test_refund_plan():
    print("\n[行動支付的退款]")
    order = Order(
        order_no="20261013000000931", receiver_name="買家", receiver_phone="0912345678",
        receiver_address="基隆市七堵區華新一路89-6號", total_amount=1_510,
        payment_method=PaymentMethod.twqr, payment_status=PaymentStatus.paid,
        paid_at=datetime.now(), status=OrderStatus.paid, refunded_amount=0,
        ecpay_trade_no="2610131234567890",
    )
    plan = refunds.refund_plan(order)
    check("不能用綠界的退款 API", plan["can_use_api"] is False, str(plan))
    check("標題講要到歐付寶退", "歐付寶" in plan["title"], plan["title"])
    steps = " ".join(plan["steps"])
    check("步驟講歐付寶廠商後台或 APP", "歐付寶廠商後台" in steps and "歐付寶 APP" in steps, steps)
    check("步驟講回來按「標記為已退款」", "標記為已退款" in steps, steps)
    check("不給綠界後台的連結（退款不在那裡）", plan.get("vendor_url", "missing") is None, str(plan))
    check("可退金額照算", plan["remaining"] == 1_510)
    check("在不能走 API 的清單裡", PaymentMethod.twqr.value in refunds.NO_API_METHODS)

    client, Session = make_app()
    add_order(Session, "20261013000000932", 1_510, payment_status=PaymentStatus.paid,
              paid_at=datetime.now(), ecpay_trade_no="2610131234567891")
    from app.routers.payments import do_refund, refund_plan as plan_endpoint
    db = Session()
    try:
        out = plan_endpoint("20261013000000932", db=db)
        check("退款說明端點不會補上綠界連結", out["vendor_url"] is None, str(out["vendor_url"]))
        try:
            do_refund("20261013000000932", {"mode": "api", "amount": 1510}, db=db)
            check("用 API 退會被擋", False, "沒有被擋下來")
        except HTTPException as exc:
            check("用 API 退會被擋", exc.status_code == 400, str(exc.detail))
        result = do_refund("20261013000000932", {"mode": "manual", "amount": 1510,
                                                 "note": "歐付寶後台已退款"}, db=db)
        check("在歐付寶退完回來可以標記為已退款", result["ok"] is True, str(result))
    finally:
        db.close()


# ---------------------------------------------------------------- 文字與前端

def test_text_and_frontend():
    print("\n[條款、SEO 與前端]")
    from app import policies

    terms = " ".join(str(v) for v in policies.DEFAULTS.values())
    check("服務條款的付款方式有行動支付", "行動支付（TWQR）" in terms)
    check("退款條款講行動支付退回原支付 App", "行動支付的退款" in terms)

    seo = (ROOT / "backend/app/routers/seo.py").read_text("utf-8")
    check("結構化資料的 paymentAccepted 有行動支付", "行動支付" in seo)

    src = ROOT / "frontend/src"
    cart = (src / "pages/Cart.jsx").read_text("utf-8")
    check("結帳頁看金額限制", "min_amount" in cart and "max_amount" in cart)
    check("金額限制用扣掉手續費的總額（不會來回跳）", "cod_fee" in cart and "payableBase" in cart)
    check("店家關掉的付款方式不顯示", "p.offered !== false" in cart)
    check("審核中的說明看 cod_only", "options?.cod_only" in cart)
    check("不再用「有選項停用」猜審核中", "payment?.some((p) => p.disabled)" not in cart)
    check("一種都不能用時不讓送出", "noPayment" in cart and "|| noPayment}" in cart)
    check("一種都不能用時有說明", "目前沒有能用的付款方式" in cart)

    home = (src / "pages/Home.jsx").read_text("utf-8")
    sections = (src / "components/sections/HomeSections.jsx").read_text("utf-8")
    check("正式首頁的「可溯源」維持原樣（只有預覽才變連結）",
          "traceLink={Boolean(preview)}" in home and "traceLink ? settings.traceability_code" in sections)
    check("預覽切換列只在網址有 ?info= 時出現", "{preview && <InfoPreviewBar" in home)

    panel = (src / "components/PaymentActionPanel.jsx").read_text("utf-8")
    check("重新付款可以改用行動支付", "'twqr'" in panel)
    check("重新付款的上限跟後端一樣", "max: 49999" in panel and "min: 6" in panel)
    check("重新付款只列店家有開放的", "payment_methods_enabled" in panel)
    check("重新付款的說明跟結帳頁一樣", "LINE Pay 目前不適用" in panel)

    admin = (src / "pages/admin/AdminSettings.jsx").read_text("utf-8")
    check("後台可以開關行動支付", "value: 'twqr'" in admin)
    check("後台提醒退款在歐付寶", "歐付寶" in admin)

    orders = (src / "pages/admin/AdminOrders.jsx").read_text("utf-8")
    check("沒有綠界連結時不顯示那顆按鈕", "refund.plan.vendor_url &&" in orders)


if __name__ == "__main__":
    print("=" * 60)
    print("行動支付（TWQR）測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)
    for fn in (
        test_maps_and_limits, test_checkout_options, test_create_and_checkout,
        test_change_payment_method, test_payment_result, test_refund_plan,
        test_text_and_frontend,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{len(failures)} 項失敗（{passed} 項通過）：")
        for f in failures:
            print("  -", f)
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
