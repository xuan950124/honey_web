"""退款：判斷、權限、以及「按下去錢就出去」的防呆。

## 為什麼這一份要特別小心

退款是後台**唯一一個按錯就把錢送出去、而且收不回來**的操作。
所以測的重點不是「功能會不會動」，而是：

- 不該退的退不了（沒收到錢、已經退完、金額超過餘額）
- 不能用 API 的付款方式**不會**出現那顆按鈕（ATM／超商代碼／貨到付款）
- 退完之後帳要對得起來（庫存還原、累積消費扣回、訂單改成已取消）

執行：
    cd backend
    python tests/test_refunds.py
"""
from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, main, refunds  # noqa: E402
from app.models import (  # noqa: E402
    Base, Order, OrderItem, OrderStatus, PaymentMethod, PaymentStatus, Product,
    User, UserRole,
)
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


def make_order(method=PaymentMethod.credit, paid_days_ago=0, amount=1000,
               status=PaymentStatus.paid, refunded=0):
    return Order(
        order_no="20260822001", receiver_name="買家", receiver_phone="0912345678",
        receiver_address="基隆市七堵區華新一路89-6號",
        total_amount=amount, payment_method=method, payment_status=status,
        paid_at=datetime.now() - timedelta(days=paid_days_ago),
        status=OrderStatus.paid, refunded_amount=refunded,
        ecpay_trade_no="2608220001234567",
    )


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
    db.commit()
    db.close()

    from fastapi.testclient import TestClient
    client = TestClient(main.app, raise_server_exceptions=False)
    staff = {"Authorization": f"Bearer {create_access_token(1)}"}
    member = {"Authorization": f"Bearer {create_access_token(2)}"}
    return client, Session, staff, member


def add_order(Session, **kwargs):
    db = Session()
    order = make_order(**kwargs)
    db.add(order)
    db.flush()
    db.add(OrderItem(order_id=order.id, product_id=1, product_name="龍眼蜜", unit_price=680, quantity=2))
    db.commit()
    db.close()


# ---------------------------------------------------------------- 判斷（純函式）

def test_plan_by_payment_method():
    """該怎麼退，是由「付款方式 + 付款日期」決定的。

    這件事不該讓使用者自己記 —— 記錯的代價是錢退不出去或退錯方式。
    """
    print("\n[怎麼退取決於付款方式與天數]")

    today = refunds.refund_plan(make_order(paid_days_ago=0))
    check("信用卡．今天付的 → 取消授權", today["action"] == refunds.ACTION_ABANDON, str(today))
    check("取消授權能用 API", today["can_use_api"] is True)
    check("說明有講「帳單不會出現」",
          any("不會出現" in s for s in today["steps"]), str(today["steps"]))

    old = refunds.refund_plan(make_order(paid_days_ago=2))
    check("信用卡．前幾天付的 → 退刷", old["action"] == refunds.ACTION_REFUND, str(old))
    check("退刷說明有提醒要等 7～14 天",
          any("7" in s and "14" in s for s in old["steps"]),
          "客人看到帳單先扣款會嚇到，這句話要先講")

    for method, keyword in [(PaymentMethod.atm, "ATM"), (PaymentMethod.cvs_code, "超商代碼")]:
        plan = refunds.refund_plan(make_order(method=method))
        check(f"{keyword} 不能用 API 退", plan["can_use_api"] is False, str(plan["title"]))
        check(f"{keyword} 有講要自己匯款",
              any("匯款" in s for s in plan["steps"]), str(plan["steps"]))

    cod = refunds.refund_plan(make_order(method=PaymentMethod.cod))
    check("貨到付款不能用 API 退", cod["can_use_api"] is False)
    check("貨到付款有講「還沒取貨就讓它退回」",
          any("退回" in s for s in cod["steps"]), str(cod["steps"]))


def test_plan_edge_cases():
    print("\n[不該退的要說清楚]")

    unpaid = refunds.refund_plan(make_order(status=PaymentStatus.unpaid))
    check("沒收到錢就不用退", unpaid["can_use_api"] is False)
    check("並建議直接取消訂單",
          any("取消" in s for s in unpaid["steps"]), str(unpaid["steps"]))

    done = refunds.refund_plan(make_order(refunded=1000))
    check("已全額退完就沒得退", done["remaining"] == 0)
    check("已退完不給按 API", done["can_use_api"] is False)

    partial = make_order(refunded=300)
    check("部分退款後餘額算得對", refunds.refundable_amount(partial) == 700,
          str(refunds.refundable_amount(partial)))


def test_apply_refund_accounting():
    """退款要能累加，而且只有退滿才算 refunded。

    只記布林值的話，一筆「只退運費 70 元」的訂單會被當成整筆沒收到錢，
    報表就整個錯了。
    """
    print("\n[金額與狀態的帳要對]")
    order = make_order()
    refunds.apply_refund(order, 300, "manual", "先退運費")
    check("累加第一次", float(order.refunded_amount) == 300)
    check("部分退款仍是已付款", order.payment_status == PaymentStatus.paid,
          "整筆退完才改狀態，不然報表會把只退了運費的訂單當成沒收到錢")
    check("有記下備註", order.refund_note == "先退運費")

    refunds.apply_refund(order, 700, "api")
    check("累加第二次", float(order.refunded_amount) == 1000)
    check("退滿了才改成已退款", order.payment_status == PaymentStatus.refunded)
    check("有記下退款時間", order.refunded_at is not None)


# ---------------------------------------------------------------- API

def test_refund_endpoint():
    print("\n[退款端點]")
    client, Session, staff, _ = make_app()
    add_order(Session, method=PaymentMethod.atm)

    with client:
        r = client.get("/api/payments/20260822001/refund-plan", headers=staff)
        check("拿得到退款說明", r.status_code == 200, r.text[:150])
        plan = r.json()
        check("說明帶了可退餘額", plan["remaining"] == 1000, str(plan.get("remaining")))
        check("說明帶了綠界後台連結", "ecpay" in (plan.get("vendor_url") or ""))

        # ATM 不能用 API 退 —— 就算硬打也要被擋
        r = client.post("/api/payments/20260822001/refund",
                        json={"amount": 1000, "mode": "api"}, headers=staff)
        check("ATM 硬打 API 退款被擋", r.status_code == 400, str(r.status_code))

        r = client.post("/api/payments/20260822001/refund",
                        json={"amount": 1000, "mode": "manual", "note": "匯款 8/22"},
                        headers=staff)
        check("手動退款成功", r.status_code == 200, r.text[:200])

        db = Session()
        order = db.query(Order).filter(Order.order_no == "20260822001").first()
        product = db.get(Product, 1)
        check("訂單改成已取消", order.status == OrderStatus.cancelled, order.status.value)
        check("付款狀態改成已退款", order.payment_status == PaymentStatus.refunded)
        check("庫存還原了", product.stock == 7, f"{product.stock}（原本 5，訂單 2 件）")
        check("備註存下來了", order.refund_note == "匯款 8/22")
        db.close()

        # 退完就不能再退
        r = client.post("/api/payments/20260822001/refund",
                        json={"amount": 100, "mode": "manual"}, headers=staff)
        check("退完之後不能再退", r.status_code == 400, str(r.status_code))


def test_amount_guards():
    print("\n[金額的防呆]")
    client, Session, staff, _ = make_app()
    add_order(Session, method=PaymentMethod.atm)

    with client:
        for amount, label in [(0, "0 元"), (-100, "負數"), (99999, "超過訂單金額")]:
            r = client.post("/api/payments/20260822001/refund",
                            json={"amount": amount, "mode": "manual"}, headers=staff)
            check(f"{label} 被擋", r.status_code == 400, str(r.status_code))

        r = client.post("/api/payments/20260822001/refund",
                        json={"mode": "manual"}, headers=staff)
        check("沒填金額被擋", r.status_code == 400, str(r.status_code))

        # 部分退款是合法的（少寄一瓶、補償運費）
        r = client.post("/api/payments/20260822001/refund",
                        json={"amount": 70, "mode": "manual", "note": "運費補償"},
                        headers=staff)
        check("部分退款可以", r.status_code == 200, r.text[:150])
        check("回報剩下的餘額", r.json()["remaining"] == 930, str(r.json()))

        db = Session()
        order = db.query(Order).filter(Order.order_no == "20260822001").first()
        check("部分退款不會取消訂單", order.status != OrderStatus.cancelled, order.status.value)
        check("部分退款仍是已付款", order.payment_status == PaymentStatus.paid)
        db.close()


def test_permissions():
    print("\n[只有工作人員能退款]")
    client, Session, staff, member = make_app()
    add_order(Session, method=PaymentMethod.atm)

    with client:
        for label, headers in (("未登入", {}), ("一般會員", member)):
            r = client.post("/api/payments/20260822001/refund",
                            json={"amount": 1000, "mode": "manual"}, headers=headers)
            check(f"{label} 不能退款", r.status_code in (401, 403), str(r.status_code))
            r = client.get("/api/payments/20260822001/refund-plan", headers=headers)
            check(f"{label} 看不到退款說明", r.status_code in (401, 403), str(r.status_code))

        r = client.post("/api/payments/NOPE/refund",
                        json={"amount": 100, "mode": "manual"}, headers=staff)
        check("不存在的訂單回 404", r.status_code == 404, str(r.status_code))


# ---------------------------------------------------------------- 前端

def test_refund_fields_reach_the_frontend():
    """訂單清單要帶退款欄位，後台才看得出「已經退了多少」。

    少了這幾個欄位，部分退款在畫面上完全看不出來 —— 對帳時會很痛苦。
    """
    print("\n[訂單有帶退款欄位]")
    from app.schemas import OrderOut

    for key in ("refunded_amount", "refunded_at", "refund_note"):
        check(f"OrderOut 有 {key}", key in OrderOut.model_fields, key)

    client, Session, staff, _ = make_app()
    add_order(Session, method=PaymentMethod.credit)
    with client:
        rows = client.get("/api/orders", headers=staff).json()
        row = next(r for r in rows if r["order_no"] == "20260822001")
        check("清單回得出付款狀態", row["payment_status"] == "paid", str(row.get("payment_status")))
        check("清單回得出已退金額", row["refunded_amount"] == 0, str(row.get("refunded_amount")))


def test_frontend_wiring():
    print("\n[後台介面]")
    src = ROOT / "frontend/src"
    orders = (src / "pages/admin/AdminOrders.jsx").read_text("utf-8")

    check("有退款按鈕", "openRefund" in orders)

    """退款按鈕不能被關在「未付款」的區塊裡。

    這是實際踩過的坑：按鈕的條件寫成 `o.payment_status === 'paid'`，
    但整段被包在 `isUnpaid(o) && (...)` 裡面 —— 而 isUnpaid 依定義
    就不會包含已付款的訂單，所以那顆按鈕**永遠不會出現**。
    條件本身沒錯，錯在放的位置。
    """
    unpaid_start = orders.index("{isUnpaid(o) && (")
    unpaid_end = orders.index("{o.payment_status === 'paid' && (")
    check("退款按鈕在未付款區塊之外",
          unpaid_start < unpaid_end
          and "openRefund" not in orders[unpaid_start:unpaid_end],
          "包在 isUnpaid 裡面的話，已付款的訂單永遠看不到這顆按鈕")
    check("已付款時才顯示退款",
          "o.payment_status === 'paid' &&" in orders,
          "沒收到錢的訂單不該有退款按鈕，直接取消就好")
    check("已退款的訂單看得到紀錄",
          "o.payment_status === 'refunded'" in orders and "已全額退款" in orders)
    check("會先問後端該怎麼退", "api.refundPlan" in orders)
    check("步驟排成清單", "refund.plan.steps" in orders)
    check("有綠界後台的出口", "vendor_url" in orders)
    check("有「標記為已退款」", "標記為已退款" in orders)
    check("API 那顆按鈕只在能用時出現", "refund.plan.can_use_api &&" in orders)

    # 「你確定嗎」的框大家都直接按確定，所以要求重打金額
    check("API 退款要重打一次金額",
          "window.prompt" in orders and "重新輸入金額" in orders,
          "確認框沒有用，要逼人真的看一眼自己在退多少")
    check("金額不符就取消",
          "已取消這次退款" in orders)

    client_js = (src / "api/client.js").read_text("utf-8")
    check("client 有 refundPlan", "refundPlan" in client_js)
    check("client 有 refundOrder", "refundOrder" in client_js)


def test_print_label_auth():
    """列印託運單是「瀏覽器直接開一個網址」，不會帶 Authorization 標頭。

    這是實際踩過的坑：前端 window.open 到後端的列印網址，
    而登入權杖存在 localStorage、只有 fetch 會幫忙加上去 ——
    所以那一頁一定被權限檢查擋下來，顯示「登入憑證無效或已過期」。

    解法不是把登入權杖放進網址（它有七天效期，而網址會留在瀏覽器紀錄、
    Referer 與伺服器日誌裡），而是發一張只能列印、只活五分鐘的通行證。
    """
    print("\n[列印託運單的授權]")
    from app.security import create_access_token as login_token
    from app.security import create_action_token, verify_action_token

    token = create_action_token("print-label", 1, minutes=5)
    check("自己的用途通得過", verify_action_token(token, "print-label") == "1")
    check("換一個用途就不認", verify_action_token(token, "other") is None,
          "少了用途比對的話，這張通行證等於萬用鑰匙")
    check("登入權杖不能當通行證用",
          verify_action_token(login_token(1), "print-label") is None,
          "登入權杖有七天效期，不該能拿來開網址")
    check("亂寫的擋掉", verify_action_token("not-a-token", "print-label") is None)
    check("空字串擋掉", verify_action_token("", "print-label") is None)

    client, Session, staff, member = make_app()
    db = Session()
    order = make_order(method=PaymentMethod.credit)
    order.allpay_logistics_id = "49794078"
    order.cvs_payment_no = "E8691558"
    order.cvs_validation_no = "4533"
    db.add(order)
    db.commit()
    order_id = order.id
    db.close()

    with client:
        r = client.get(f"/api/logistics/orders/{order_id}/print")
        check("沒帶通行證回 401", r.status_code == 401, str(r.status_code))
        check("錯誤訊息說得出怎麼辦",
              "重新按一次" in r.json().get("detail", ""), str(r.json().get("detail")))

        r = client.post(f"/api/logistics/orders/{order_id}/print-token", headers=staff)
        check("工作人員換得到通行證", r.status_code == 200, r.text[:150])
        issued = r.json()["token"]

        r = client.get(f"/api/logistics/orders/{order_id}/print?t={issued}")
        check("帶了通行證就開得起來", r.status_code == 200, str(r.status_code))
        check("回的是綠界的自動送出表單",
              "<form" in r.text and "ecpay" in r.text.lower(), r.text[:150])

        for label, headers in (("未登入", {}), ("一般會員", member)):
            r = client.post(f"/api/logistics/orders/{order_id}/print-token", headers=headers)
            check(f"{label} 換不到通行證", r.status_code in (401, 403), str(r.status_code))

    # 前端要走「先換票再開視窗」，而且視窗要先開再填網址
    orders_jsx = (ROOT / "frontend/src/pages/admin/AdminOrders.jsx").read_text("utf-8")
    check("前端會先換通行證", "api.printToken" in orders_jsx)
    check("網址帶上通行證", "print?t=" in orders_jsx)
    check("視窗先開再填網址",
          orders_jsx.index("window.open('', '_blank'") < orders_jsx.index("api.printToken"),
          "等 await 回來才 window.open 會被瀏覽器當成彈出視窗擋掉")

    client_js2 = (ROOT / "frontend/src/api/client.js").read_text("utf-8")
    check("client 有 printToken", "printToken" in client_js2)


if __name__ == "__main__":
    print("=" * 60)
    print("退款測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_plan_by_payment_method, test_plan_edge_cases, test_apply_refund_accounting,
        test_refund_endpoint, test_amount_guards, test_permissions,
        test_refund_fields_reach_the_frontend, test_frontend_wiring,
        test_print_label_auth,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
