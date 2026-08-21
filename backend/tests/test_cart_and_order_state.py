"""購物車同步與訂單狀態一致性的測試。

三個實際回報的問題：
  1. 兩個地方開的網站購物車不同步（購物車只存在瀏覽器裡）
  2. 客戶端不能取消訂單
  3. 訂單被標成「已完成」卻同時顯示「未付款．前往付款」

第 3 個是狀態機的矛盾，最值得釘住 ——
所以下面用「每一種狀態組合都跑一次」的方式測，而不是只測幾個案例。

執行：
    cd backend
    python tests/test_cart_and_order_state.py
"""
from __future__ import annotations

import itertools
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
# 背景工作會在另一個執行緒開資料庫連線，跟測試自己的連線互相干擾
# （SQLite 的 StaticPool 只有一條連線，交易會互相蓋掉）。測試一律關掉。
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, main  # noqa: E402
from app.models import (  # noqa: E402
    Base, CartItem, LogisticsStatus, Order, OrderItem, OrderStatus, PaymentMethod,
    PaymentStatus, Product, User, UserRole,
)
from app.routers.orders import _decorate, new_access_token  # noqa: E402
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
    return TestClient(main.app, raise_server_exceptions=False), Session


def make_app_with_users():
    """帶好工作人員與一般會員的測試環境（權限測試用）。"""
    client, Session = make_app()
    db = Session()
    db.add(User(id=1, email="staff@huanglong-honey.com", name="工作人員",
                hashed_password=hash_password("x"), role=UserRole.staff))
    db.add(User(id=2, email="member@huanglong-honey.com", name="會員",
                hashed_password=hash_password("x"), role=UserRole.member))
    db.commit()
    db.close()
    return (client, Session,
            {"Authorization": f"Bearer {create_access_token(1)}"},
            {"Authorization": f"Bearer {create_access_token(2)}"})


def make_order(**kw) -> Order:
    defaults = dict(
        order_no="20260818120000123",
        access_token=new_access_token(),
        receiver_name="測試", receiver_phone="0912345678",
        receiver_address="基隆市七堵區某某路 1 號",
        subtotal=680, shipping_fee=70, total_amount=750,
        status=OrderStatus.pending,
        payment_method=PaymentMethod.credit,
        payment_status=PaymentStatus.unpaid,
        logistics_status=LogisticsStatus.none,
        created_at=datetime(2026, 8, 18, 12, 0, 0),
    )
    defaults.update(kw)
    return Order(**defaults)


# ---------------------------------------------------------------- 狀態一致性

def test_no_contradictory_states():
    print("\n[「已完成」不能同時叫人去付款]")

    # 把所有狀態組合都跑一次，確保沒有前後矛盾的畫面
    combos = itertools.product(
        list(OrderStatus),
        list(PaymentStatus),
        [PaymentMethod.credit, PaymentMethod.cod],
        [LogisticsStatus.none, LogisticsStatus.created, LogisticsStatus.picked],
    )
    bad_pay, bad_cancel = [], []
    for status, pay_status, method, logi in combos:
        order = make_order(status=status, payment_status=pay_status,
                           payment_method=method, logistics_status=logi)
        _decorate(order, 3)

        # 規則一：只有「待處理」的訂單才可能需要付款
        if order.can_retry_payment and status != OrderStatus.pending:
            bad_pay.append(f"{status.value}/{pay_status.value}/{method.value}")
        # 規則二：已付款、已出貨、已完成、已取消都不能由買家取消
        if order.can_cancel and (
            status != OrderStatus.pending
            or pay_status == PaymentStatus.paid
            or logi != LogisticsStatus.none
        ):
            bad_cancel.append(f"{status.value}/{pay_status.value}/{logi.value}")

    check("沒有任何組合會在非待處理時要求付款", not bad_pay, str(bad_pay[:4]))
    check("沒有任何組合會讓不該取消的訂單顯示取消", not bad_cancel, str(bad_cancel[:4]))

    # 使用者實際遇到的那一筆：已完成 + 未付款 + 超商取貨
    real = make_order(status=OrderStatus.completed, payment_status=PaymentStatus.unpaid,
                      payment_method=PaymentMethod.credit)
    _decorate(real, 3)
    check("已完成 + 未付款 → 不再顯示前往付款", real.can_retry_payment is False)
    check("已完成 + 未付款 → 也不顯示繳費期限", real.payment_deadline is None)
    check("已完成 + 未付款 → 不能由買家取消", real.can_cancel is False)

    # 正常的待付款訂單仍要能付款與取消
    normal = make_order()
    _decorate(normal, 3)
    check("待處理 + 未付款 → 可以付款", normal.can_retry_payment is True)
    check("待處理 + 未付款 → 可以取消", normal.can_cancel is True)
    check("待處理 + 未付款 → 有繳費期限", normal.payment_deadline is not None)

    # 貨到付款：不用線上付款，但取貨前可以取消
    cod = make_order(payment_method=PaymentMethod.cod)
    _decorate(cod, 3)
    check("貨到付款不顯示前往付款", cod.can_retry_payment is False)
    check("貨到付款仍可取消", cod.can_cancel is True)

    # 已建立物流單 = 已經在出貨流程裡，不能自助取消
    shipping = make_order(logistics_status=LogisticsStatus.created)
    _decorate(shipping, 3)
    check("已建物流單不能自助取消", shipping.can_cancel is False)


def test_mark_paid_is_opt_in():
    print("\n[出貨與收款是兩件事]")
    client, Session = make_app()
    db = Session()
    staff = User(email="s@x.com", hashed_password=hash_password("x"),
                 name="員工", role=UserRole.staff)
    db.add(staff)
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    token = create_access_token(staff.id)

    a = make_order(order_no="A0000000000000001")
    b = make_order(order_no="B0000000000000001")
    db.add_all([a, b])
    db.commit()
    ids = (a.id, b.id)
    db.close()

    head = {"Authorization": f"Bearer {token}"}
    with client:
        # 預設不動付款狀態
        r = client.patch(f"/api/orders/{ids[0]}/status",
                         json={"status": "completed"}, headers=head)
        check("改成已完成回 200", r.status_code == 200, str(r.status_code))
        check("預設不會偷偷標成已付款",
              r.json()["payment_status"] == "unpaid", str(r.json()["payment_status"]),)
        check("已完成的訂單不再要求付款",
              r.json()["can_retry_payment"] is False)

        # 明確勾選才動
        r = client.patch(f"/api/orders/{ids[1]}/status",
                         json={"status": "completed", "mark_paid": True}, headers=head)
        check("勾了才會標成已付款",
              r.json()["payment_status"] == "paid", str(r.json()["payment_status"]))
        check("標成已付款後有付款時間", bool(r.json()["paid_at"]))


def test_cancel_permissions():
    print("\n[取消訂單的權限]")
    client, Session = make_app()
    db = Session()
    alice = User(email="a@x.com", hashed_password=hash_password("x"), name="A")
    bob = User(email="b@x.com", hashed_password=hash_password("x"), name="B")
    db.add_all([alice, bob])
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    a_token, b_token = create_access_token(alice.id), create_access_token(bob.id)

    mine = make_order(order_no="MINE000000000001", user_id=alice.id)
    paid = make_order(order_no="PAID000000000001", user_id=alice.id,
                      payment_status=PaymentStatus.paid)
    done = make_order(order_no="DONE000000000001", user_id=alice.id,
                      status=OrderStatus.completed)
    guest = make_order(order_no="GUES000000000001", user_id=None)
    db.add_all([mine, paid, done, guest])
    db.commit()
    db.close()

    A = {"Authorization": f"Bearer {a_token}"}
    B = {"Authorization": f"Bearer {b_token}"}
    with client:
        r = client.post("/api/orders/by-no/MINE000000000001/cancel", headers=A)
        check("本人可以取消自己的訂單", r.status_code == 200, str(r.status_code))
        check("取消後狀態變成已取消",
              r.json()["status"] == "cancelled", str(r.json().get("status")))
        check("取消後不再顯示可取消", r.json()["can_cancel"] is False)

        r = client.post("/api/orders/by-no/PAID000000000001/cancel", headers=A)
        check("已付款的不能自助取消", r.status_code == 400, str(r.status_code))
        check("已付款的錯誤訊息叫他聯絡我們",
              "聯絡" in r.json().get("detail", ""), str(r.json()))

        r = client.post("/api/orders/by-no/DONE000000000001/cancel", headers=A)
        check("已完成的不能取消", r.status_code == 400, str(r.status_code))

        r = client.post("/api/orders/by-no/MINE000000000001/cancel", headers=B)
        check("別人的訂單取消不了", r.status_code in (403, 404), str(r.status_code))

        r = client.post("/api/orders/by-no/GUES000000000001/cancel", headers=A)
        check("訪客訂單不能被會員取消", r.status_code in (403, 404), str(r.status_code))

        r = client.post("/api/orders/by-no/MINE000000000001/cancel")
        check("沒登入不能取消", r.status_code in (401, 403), str(r.status_code))


def test_cancel_restores_stock():
    print("\n[取消訂單要把庫存還回去]")
    client, Session = make_app()
    db = Session()
    user = User(email="a@x.com", hashed_password=hash_password("x"), name="A")
    db.add(user)
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=5))
    db.commit()
    token = create_access_token(user.id)
    db.close()

    head = {"Authorization": f"Bearer {token}"}
    with client:
        r = client.post("/api/orders", headers=head, json={
            "receiver_name": "測試", "receiver_phone": "0912345678",
            "items": [{"product_id": 1, "quantity": 2}],
            "shipping_method": "cvs_unimart_c2c", "payment_method": "credit",
            "cvs_store_id": "991182", "cvs_store_name": "測試門市",
        })
        check("下單成功", r.status_code == 201, str(r.status_code)[:200])
        order_no = r.json()["order"]["order_no"]

        db = Session()
        check("下單後庫存扣掉 2", db.get(Product, 1).stock == 3, str(db.get(Product, 1).stock))
        db.close()

        r = client.post(f"/api/orders/by-no/{order_no}/cancel", headers=head)
        check("可以取消", r.status_code == 200, str(r.status_code))

        db = Session()
        check("取消後庫存還原成 5", db.get(Product, 1).stock == 5, str(db.get(Product, 1).stock))
        db.close()


# ---------------------------------------------------------------- 購物車同步

def test_cart_sync():
    print("\n[購物車跟著帳號走]")
    client, Session = make_app()
    db = Session()
    user = User(email="a@x.com", hashed_password=hash_password("x"), name="A")
    other = User(email="b@x.com", hashed_password=hash_password("x"), name="B")
    db.add_all([user, other])
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10, spec="700g"))
    db.add(Product(id=2, name="百花蜜", price=500, stock=10))
    db.add(Product(id=3, name="已下架", price=300, stock=10, is_active=False))
    db.add(Product(id=4, name="已售完", price=300, stock=0))
    db.commit()
    token = create_access_token(user.id)
    other_token = create_access_token(other.id)
    db.close()

    head = {"Authorization": f"Bearer {token}"}
    with client:
        r = client.get("/api/cart", headers=head)
        check("新帳號的購物車是空的", r.json() == [], str(r.json()))

        # 家裡的電腦加了東西
        r = client.put("/api/cart", headers=head, json={
            "items": [{"product_id": 1, "quantity": 2}],
        })
        check("存得起來", r.status_code == 200, str(r.status_code))
        check("回傳含商品名稱與價格",
              r.json()[0]["name"] == "龍眼蜜" and r.json()[0]["price"] == 680, str(r.json()))
        check("回傳含庫存（前端要用來擋數量）", r.json()[0]["stock"] == 10)

        # 換一台電腦（等同新的瀏覽器）→ 讀得到
        r = client.get("/api/cart", headers=head)
        check("換裝置讀得到同一台購物車",
              len(r.json()) == 1 and r.json()[0]["quantity"] == 2, str(r.json()))

        # 別人的購物車完全隔離
        r = client.get("/api/cart", headers={"Authorization": f"Bearer {other_token}"})
        check("看不到別人的購物車", r.json() == [], str(r.json()))

        # 合併：本機有 3 罐龍眼蜜 + 1 罐百花蜜，伺服器有 2 罐龍眼蜜
        r = client.post("/api/cart/merge", headers=head, json={
            "items": [{"product_id": 1, "quantity": 3}, {"product_id": 2, "quantity": 1}],
        })
        by_id = {row["id"]: row for row in r.json()}
        check("合併後兩種商品都在", set(by_id) == {1, 2}, str(set(by_id)))
        check("同商品取較多的那一邊（不是相加）",
              by_id[1]["quantity"] == 3, str(by_id[1]["quantity"]))
        check("本機獨有的商品被帶進來", by_id[2]["quantity"] == 1)

        # 合併時本機比較少 → 保留伺服器的
        r = client.post("/api/cart/merge", headers=head, json={
            "items": [{"product_id": 1, "quantity": 1}],
        })
        by_id = {row["id"]: row for row in r.json()}
        check("本機比較少時保留伺服器的數量",
              by_id[1]["quantity"] == 3, str(by_id[1]["quantity"]))

        # 下架與售完的商品不該留在購物車
        client.put("/api/cart", headers=head, json={
            "items": [{"product_id": 1, "quantity": 1},
                      {"product_id": 3, "quantity": 1},
                      {"product_id": 4, "quantity": 1}],
        })
        r = client.get("/api/cart", headers=head)
        ids = {row["id"] for row in r.json()}
        check("下架商品自動移除", 3 not in ids, str(ids))
        check("售完商品自動移除", 4 not in ids, str(ids))
        check("正常商品留著", 1 in ids, str(ids))

        # 超過庫存會被壓回上限
        client.put("/api/cart", headers=head, json={
            "items": [{"product_id": 1, "quantity": 99}],
        })
        db = Session()
        db.get(Product, 1).stock = 4
        db.commit()
        db.close()
        r = client.get("/api/cart", headers=head)
        check("庫存變少時數量跟著壓下來",
              r.json()[0]["quantity"] == 4, str(r.json()[0]["quantity"]))

        # 清空
        r = client.delete("/api/cart", headers=head)
        check("清空回 204", r.status_code == 204, str(r.status_code))
        check("清空後真的空了", client.get("/api/cart", headers=head).json() == [])

        # 沒登入不能碰
        check("沒登入讀不到購物車",
              client.get("/api/cart").status_code in (401, 403))
        check("沒登入存不了購物車",
              client.put("/api/cart", json={"items": []}).status_code in (401, 403))


def test_cart_rejects_bad_input():
    print("\n[購物車擋掉髒資料]")
    client, Session = make_app()
    db = Session()
    user = User(email="a@x.com", hashed_password=hash_password("x"), name="A")
    db.add(user)
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    token = create_access_token(user.id)
    db.close()

    head = {"Authorization": f"Bearer {token}"}
    with client:
        for bad in (0, -1, -100):
            r = client.put("/api/cart", headers=head,
                           json={"items": [{"product_id": 1, "quantity": bad}]})
            check(f"數量 {bad} 被拒絕", r.status_code == 422, str(r.status_code))

        r = client.put("/api/cart", headers=head,
                       json={"items": [{"product_id": 1, "quantity": 100000}]})
        check("數量 100000 被拒絕", r.status_code == 422, str(r.status_code))

        r = client.put("/api/cart", headers=head,
                       json={"items": [{"product_id": 99999, "quantity": 1}]})
        check("不存在的商品被忽略而不是報錯",
              r.status_code == 200 and r.json() == [], f"{r.status_code} {r.json()}")

        # 同商品送兩行要合併，不能變成兩列
        r = client.put("/api/cart", headers=head, json={"items": [
            {"product_id": 1, "quantity": 2}, {"product_id": 1, "quantity": 3},
        ]})
        check("同商品兩行會合併成一列", len(r.json()) == 1, str(r.json()))
        check("合併後數量是相加的 5",
              r.json()[0]["quantity"] == 5, str(r.json()[0]["quantity"]))


def test_customer_facing_labels():
    """已完成的訂單不能對客人顯示「未付款」。

    東西都收到了，網站卻說沒付錢 —— 客人會以為自己欠款，
    嚴重一點會跑去重付一次。
    """
    print("\n[已完成的訂單不對客人喊未付款]")
    src = (ROOT / "frontend/src/api/client.js").read_text("utf-8")

    check("有共用的付款字樣函式", "export const paymentTextFor" in src)
    check("有共用的顏色函式", "export const paymentToneFor" in src)
    check("已出貨／已完成會改顯示付款方式",
          "'shipped', 'completed'" in src and "payment_method_label" in src)
    check("退款狀態仍照實顯示", "refunded" in src)

    for page in ("frontend/src/pages/Member.jsx", "frontend/src/pages/OrderDetail.jsx"):
        text = (ROOT / page).read_text("utf-8")
        name = page.split("/")[-1]
        check(f"{name} 用共用函式", "paymentTextFor(" in text)
        check(f"{name} 不再自己拼付款字樣", "PAYMENT_STATUS_TEXT[" not in text,
              "自己拼就會漏掉已完成那種情況")

    detail = (ROOT / "frontend/src/pages/OrderDetail.jsx").read_text("utf-8")
    check("訂單頁標題先看訂單狀態", detail.index("order.status === 'completed'")
          < detail.index("failed\n") if "failed\n" in detail else True)
    check("已完成有專屬標題", "訂單已完成" in detail)
    check("已出貨有專屬標題", "商品已出貨" in detail)

    admin = (ROOT / "frontend/src/pages/admin/AdminOrders.jsx").read_text("utf-8")
    check("後台找得出帳沒對上的訂單", "isMismatch" in admin)
    check("帳沒對上有獨立統計", "帳沒對上" in admin)
    check("帳沒對上可以一鍵補收款", "已收款" in admin)


def test_frontend_wiring():
    print("\n[前端有接上]")
    src = ROOT / "frontend/src"

    ctx = (src / "context/CartContext.jsx").read_text("utf-8")
    check("購物車有呼叫合併 API", "mergeCart" in ctx)
    check("購物車變動會存到伺服器", "saveCart" in ctx)
    check("清空時也清伺服器那份", "clearCart" in ctx)
    check("登出時清掉本機購物車", "登出" in ctx and "setItems([])" in ctx)
    check("有做延遲同步（不要每按一下就打 API）", "SYNC_DELAY" in ctx)

    member = (src / "pages/Member.jsx").read_text("utf-8")
    check("會員中心有取消訂單", "cancelOrder" in member)
    check("取消前會先確認", "確定取消" in member)
    check("用後端的 can_cancel 判斷", "can_cancel" in member)
    check("用後端的 can_retry_payment 判斷", "can_retry_payment" in member)

    admin = (src / "pages/admin/AdminOrders.jsx").read_text("utf-8")
    check("後台改狀態前會檢查有沒有收到錢", "requestStatus" in admin)
    check("後台提供「同時註記已收款」", "同時註記已收款" in admin)
    check("後台也提供「只改狀態」", "只改狀態" in admin)

    panel = (src / "components/PaymentActionPanel.jsx").read_text("utf-8")
    check("訂單頁用後端的 can_cancel", "order.can_cancel" in panel)


# ---------------------------------------------------------------- 待出貨的定義

def test_need_ship_definition():
    """「待出貨」= 包裹還在你手上。

    這裡踩過兩個坑，兩個都讓每天要看的數字失去意義：

    1. 原本要求 `logistics_status === 'none'`（還沒建物流單）。
       但**建完單、拿到寄件代碼、還沒拿去超商**的訂單才是最該出貨的那一批 ——
       結果真正要出的貨反而不在清單裡。
    2. 原本沒排除**已完成**的訂單。舊測試單是「已完成 + 未建單」，
       兩個條件都符合，於是佔滿了待出貨清單。
    """
    print("\n[待出貨的判斷]")
    src = (ROOT / "frontend/src/pages/admin/AdminOrders.jsx").read_text("utf-8")

    check("有獨立的判斷函式", "const isNeedShip" in src,
          "統計數字與清單分開寫的話，兩邊遲早會不一致")
    check("統計用它", "orders.filter(isNeedShip)" in src)
    check("清單也用它", "if (filter === 'need-ship') return isNeedShip(o)" in src)

    check("已建單但還沒寄的算待出貨",
          "'none', 'created', 'failed'" in src,
          "建完單還沒拿去超商的，正是最該出貨的那一批")
    check("已完成的不算待出貨",
          "'cancelled', 'completed', 'shipped'" in src,
          "舊測試單是「已完成 + 未建單」，不排除的話會佔滿清單")
    check("已寄件的不算待出貨", "'shipped'" in src)
    check("沒收到錢的不算（貨到付款除外）",
          "o.payment_status === 'paid' || o.payment_method === 'cod'" in src)

    # 待出貨裡面還要分得出「還沒建單」與「已建單等你拿去超商」
    check("分得出還沒建單的", "needLabel" in src,
          "兩者要做的事完全不同，合成一個數字看不出下一步")


def test_delete_order():
    """刪除訂單：清測試單用，但不能讓帳跟著壞掉。"""
    print("\n[刪除訂單]")
    client, Session, staff, member = make_app_with_users()

    db = Session()
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=5))
    db.commit()
    db.close()

    def make(order_no, **kw):
        db = Session()
        o = Order(order_no=order_no, receiver_name="買家", receiver_phone="0912345678",
                  receiver_address="基隆市七堵區華新一路89-6號",
                  subtotal=1360, total_amount=1360, **{"status": OrderStatus.pending, **kw})
        db.add(o)
        db.flush()
        db.add(OrderItem(order_id=o.id, product_id=1, product_name="龍眼蜜",
                         unit_price=680, quantity=2))
        db.commit()
        oid = o.id
        db.close()
        return oid

    with client:
        oid = make("20260822900")

        r = client.delete(f"/api/orders/{oid}", headers=staff)
        check("沒帶訂單編號不給刪", r.status_code == 400, str(r.status_code))
        check("錯誤訊息說得出要什麼",
              "訂單編號" in r.json().get("detail", ""), str(r.json().get("detail")))

        r = client.delete(f"/api/orders/{oid}?confirm=打錯了", headers=staff)
        check("編號打錯不給刪", r.status_code == 400, str(r.status_code))

        for label, headers in (("未登入", {}), ("一般會員", member)):
            r = client.delete(f"/api/orders/{oid}?confirm=20260822900", headers=headers)
            check(f"{label} 不能刪訂單", r.status_code in (401, 403), str(r.status_code))

        r = client.delete(f"/api/orders/{oid}?confirm=20260822900", headers=staff)
        check("編號正確就刪得掉", r.status_code == 200, r.text[:150])

        db = Session()
        check("訂單真的不見了",
              db.query(Order).filter(Order.order_no == "20260822900").first() is None)
        check("明細也跟著刪掉",
              db.query(OrderItem).filter(OrderItem.order_id == oid).count() == 0,
              "留下孤兒明細的話報表會算到不存在的訂單")
        check("庫存還原了", db.get(Product, 1).stock == 7,
              f"{db.get(Product, 1).stock}（原本 5，訂單佔 2）")
        db.close()

        r = client.delete("/api/orders/99999?confirm=x", headers=staff)
        check("不存在的訂單回 404", r.status_code == 404, str(r.status_code))

    # 已取消的訂單庫存早就還過了，不能再還一次
    with client:
        oid = make("20260822901", status=OrderStatus.cancelled, stock_restored=True)
        before = None
        db = Session()
        before = db.get(Product, 1).stock
        db.close()
        client.delete(f"/api/orders/{oid}?confirm=20260822901", headers=staff)
        db = Session()
        check("已取消的訂單不會重複還庫存", db.get(Product, 1).stock == before,
              f"{db.get(Product, 1).stock} vs {before}")
        db.close()

    src = (ROOT / "frontend/src/pages/admin/AdminOrders.jsx").read_text("utf-8")
    check("後台有刪除按鈕", "removeOrder" in src)
    check("要求輸入訂單編號", "window.prompt" in src and "訂單編號完整輸入" in src,
          "確認框大家都直接按確定，刪掉又救不回來")
    check("有引導改用取消訂單", "改用「取消訂單」" in src,
          "只是要作廢的話應該留紀錄，不是刪掉")


if __name__ == "__main__":
    print("=" * 60)
    print("購物車同步與訂單狀態測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_no_contradictory_states, test_mark_paid_is_opt_in,
        test_cancel_permissions, test_cancel_restores_stock,
        test_cart_sync, test_cart_rejects_bad_input,
        test_customer_facing_labels, test_frontend_wiring,
        test_need_ship_definition, test_delete_order,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")

