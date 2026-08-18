"""未付款／付款失敗處理、重新付款、運費計算的測試。

用 SQLite 記憶體資料庫跑，不會碰到正式資料。執行方式：

    cd backend
    python -m pytest tests -q          （有裝 pytest 的話）
    python tests/test_payment_flow.py  （沒裝也能直接跑）
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
# 背景工作會在另一個執行緒開資料庫連線，跟測試自己的連線互相干擾
# （SQLite 的 StaticPool 只有一條連線，交易會互相蓋掉）。測試一律關掉。
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (  # noqa: E402
    PAYMENT_MAP, SHIPPING_MAP, Base, LogisticsStatus, Order, OrderItem,
    OrderStatus, PaymentMethod, PaymentStatus, Product, ShippingMethod,
    SiteSetting, User, UserRole,
)
from app.routers.payments import next_trade_no  # noqa: E402
from app.shipping import (  # noqa: E402
    SHIPPING_DEFAULTS, calc_shipping_fee, unpaid_expire_days, validate_combination,
)

engine = create_engine(
    "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
)
Session = sessionmaker(bind=engine)

failures: list[str] = []
passed = 0


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(f"{name}{f' — {detail}' if detail else ''}")
        print(f"  FAIL {name}{f' — {detail}' if detail else ''}")


def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    return Session()


def make_order(db, **kw) -> Order:
    from app.routers.orders import new_access_token
    defaults = dict(
        order_no=datetime.now().strftime("%Y%m%d%H%M%S") + "001",
        access_token=new_access_token(),
        receiver_name="測試收件人",
        receiver_phone="0912345678",
        receiver_address="基隆市七堵區測試路 1 號",
        subtotal=1000,
        shipping_fee=70,
        total_amount=1070,
        status=OrderStatus.pending,
        shipping_method=ShippingMethod.cvs_unimart_c2c,
        payment_method=PaymentMethod.credit,
        payment_status=PaymentStatus.unpaid,
    )
    defaults.update(kw)
    order = Order(**defaults)
    db.add(order)
    db.flush()
    return order


# ---------------------------------------------------------------- 運費

def test_shipping_fees():
    print("\n[運費計算]")
    db = fresh_db()

    hilife, _ = calc_shipping_fee(db, 500, ShippingMethod.cvs_hilife_c2c)
    unimart, _ = calc_shipping_fee(db, 500, ShippingMethod.cvs_unimart_c2c)
    fami, _ = calc_shipping_fee(db, 500, ShippingMethod.cvs_fami_c2c)
    post, _ = calc_shipping_fee(db, 500, ShippingMethod.home_post)
    tcat, _ = calc_shipping_fee(db, 500, ShippingMethod.home_tcat)
    cold, _ = calc_shipping_fee(db, 500, ShippingMethod.home_tcat, "0003")

    check("萊爾富比 7-11 便宜", hilife < unimart, f"{hilife} vs {unimart}")
    check("7-11 與全家同價", unimart == fami, f"{unimart} vs {fami}")
    check("郵局比黑貓便宜", post < tcat, f"{post} vs {tcat}")
    check("低溫比常溫貴", cold > tcat, f"{cold} vs {tcat}")
    check("郵局不受溫層影響",
          calc_shipping_fee(db, 500, ShippingMethod.home_post, "0003")[0] == post)

    # 每個選項都要能算出運費，不能因為漏設定就變成 0
    for method in SHIPPING_MAP:
        fee, _ = calc_shipping_fee(db, 500, method)
        check(f"{SHIPPING_MAP[method][2]} 有運費", fee > 0, f"算出 {fee}")

    # 免運門檻
    db.add(SiteSetting(key="free_shipping_threshold", value="1500"))
    db.commit()
    below, free_below = calc_shipping_fee(db, 1499, ShippingMethod.cvs_unimart_c2c)
    above, free_above = calc_shipping_fee(db, 1500, ShippingMethod.cvs_unimart_c2c)
    check("未達門檻要收運費", below > 0 and not free_below)
    check("達門檻免運", above == 0 and free_above)

    # 後台改價要立刻生效
    db.add(SiteSetting(key="shipping_fee_cvs_hilife", value="45"))
    db.commit()
    check("後台可覆寫萊爾富運費",
          calc_shipping_fee(db, 100, ShippingMethod.cvs_hilife_c2c)[0] == 45)
    db.close()


def test_combination_rules():
    print("\n[送貨與付款組合]")
    for method in SHIPPING_MAP:
        _, _, label, supports_cod = SHIPPING_MAP[method]
        err = validate_combination(method, PaymentMethod.cod, 1000)
        if supports_cod:
            check(f"{label} 可貨到付款", err is None, str(err))
        else:
            check(f"{label} 擋下貨到付款", err is not None)

    check("萊爾富可貨到付款",
          validate_combination(ShippingMethod.cvs_hilife_c2c, PaymentMethod.cod, 1000) is None)
    check("超商超過兩萬要擋",
          validate_combination(ShippingMethod.cvs_hilife_c2c, PaymentMethod.credit, 20001) is not None)
    check("郵局不能低溫",
          validate_combination(ShippingMethod.home_post, PaymentMethod.credit, 1000, "0002") is not None)


def test_expire_days():
    print("\n[未付款保留天數]")
    db = fresh_db()
    check("預設 3 天", unpaid_expire_days(db) == 3, str(unpaid_expire_days(db)))

    db.add(SiteSetting(key="unpaid_expire_days", value="7"))
    db.commit()
    check("可改成 7 天", unpaid_expire_days(db) == 7)

    for bad in ("0", "-5", "abc", ""):
        db.query(SiteSetting).filter(SiteSetting.key == "unpaid_expire_days").delete()
        db.add(SiteSetting(key="unpaid_expire_days", value=bad))
        db.commit()
        days = unpaid_expire_days(db)
        check(f"「{bad}」不會變成負數", days >= 0, f"算出 {days}")
    db.close()


# ---------------------------------------------------------------- 重新付款

def test_trade_no():
    print("\n[重新付款的交易編號]")
    db = fresh_db()
    order = make_order(db, order_no="20260817120000123")

    first = next_trade_no(order)
    check("第一次就用訂單編號", first == "20260817120000123", first)

    seen = {first}
    for attempt in range(1, 12):
        order.payment_attempts = attempt
        trade_no = next_trade_no(order)
        check(f"第 {attempt + 1} 次不重複", trade_no not in seen, trade_no)
        check(f"第 {attempt + 1} 次長度合法", 1 <= len(trade_no) <= 20, f"{trade_no} 長 {len(trade_no)}")
        check(f"第 {attempt + 1} 次可還原成訂單",
              trade_no.startswith(order.order_no[:16]), trade_no)
        seen.add(trade_no)

    # 訂單編號剛好 20 碼時也不能溢位
    order.order_no = "A" * 20
    order.payment_attempts = 4
    long_no = next_trade_no(order)
    check("20 碼訂單編號不會超長", len(long_no) == 20, f"{long_no} 長 {len(long_no)}")
    db.close()


def test_find_order():
    print("\n[從綠界回傳的編號找回訂單]")
    from app.routers.payments import _find_order

    db = fresh_db()
    order = make_order(db, order_no="20260817120000123")
    order.payment_trade_no = "20260817120000R3"
    db.commit()

    check("用最新的交易編號找得到",
          _find_order(db, "20260817120000R3") is not None)
    check("用原始訂單編號也找得到",
          _find_order(db, "20260817120000123") is not None)
    check("用舊的重試編號找得到（買家繳了第一次取的號）",
          _find_order(db, "20260817120000123R2") is not None)
    check("不存在的編號回 None", _find_order(db, "99999999999999999") is None)
    check("空字串回 None", _find_order(db, "") is None)
    db.close()


# ---------------------------------------------------------------- 逾期自動取消

def test_expire_unpaid():
    print("\n[逾期未付款自動取消]")
    from app.routers.orders import expire_unpaid_orders

    db = fresh_db()
    product = Product(name="龍眼蜜 700g", price=600, stock=10)
    db.add(product)
    db.flush()

    old = datetime.now() - timedelta(days=5)
    recent = datetime.now() - timedelta(hours=2)

    def order_with_item(order_no, created, qty=2, **kw):
        o = make_order(db, order_no=order_no, created_at=created, **kw)
        o.items.append(OrderItem(product_id=product.id, product_name=product.name,
                                 unit_price=600, quantity=qty))
        return o

    stale = order_with_item("STALE0000000000001", old)
    fresh = order_with_item("FRESH0000000000001", recent)
    cod = order_with_item("COD00000000000001", old, payment_method=PaymentMethod.cod)
    paid = order_with_item("PAID0000000000001", old, payment_status=PaymentStatus.paid)
    shipping = order_with_item("SHIP0000000000001", old,
                               logistics_status=LogisticsStatus.created)
    product.stock = 10
    db.commit()

    cancelled = expire_unpaid_orders(db)
    numbers = {o.order_no for o in cancelled}

    check("逾期未付款被取消", "STALE0000000000001" in numbers)
    check("未逾期的不動", "FRESH0000000000001" not in numbers)
    check("貨到付款不動", "COD00000000000001" not in numbers)
    check("已付款的不動", "PAID0000000000001" not in numbers)
    check("已建物流單的不動", "SHIP0000000000001" not in numbers)

    db.refresh(stale)
    check("取消後狀態正確", stale.status == OrderStatus.cancelled)
    check("有寫下取消原因", bool(stale.cancel_reason), str(stale.cancel_reason))
    db.refresh(product)
    check("庫存被還原", product.stock == 12, f"目前 {product.stock}")

    # 再跑一次不能重複加庫存
    expire_unpaid_orders(db)
    db.refresh(product)
    check("重跑不會重複加庫存", product.stock == 12, f"目前 {product.stock}")

    # 關掉自動取消
    db.add(SiteSetting(key="unpaid_expire_days", value="0"))
    db.commit()
    check("設 0 就完全不動", expire_unpaid_orders(db) == [])
    db.refresh(fresh)
    check("關掉後未逾期訂單仍正常", fresh.status == OrderStatus.pending)
    db.close()


def test_restore_stock_on_manual_cancel():
    print("\n[手動取消也要還原庫存]")
    from app.routers.orders import _restore_stock

    db = fresh_db()
    product = Product(name="百花蜜 700g", price=500, stock=5)
    db.add(product)
    db.flush()

    order = make_order(db, order_no="MANUAL000000000001")
    order.items.append(OrderItem(product_id=product.id, product_name=product.name,
                                 unit_price=500, quantity=3))
    db.commit()

    _restore_stock(db, order)
    db.flush()
    db.refresh(product)
    check("庫存加回來", product.stock == 8, f"目前 {product.stock}")

    _restore_stock(db, order)
    db.flush()
    db.refresh(product)
    check("重複呼叫不會多加", product.stock == 8, f"目前 {product.stock}")
    check("有記下已還原旗標", order.stock_restored is True)
    db.close()


# ---------------------------------------------------------------- 換付款方式

def test_change_payment_method():
    print("\n[換一種付款方式]")
    from app.routers.orders import change_payment_method
    from app.schemas import PaymentMethodUpdate
    from fastapi import HTTPException

    db = fresh_db()
    user = User(email="a@example.com", hashed_password="x", name="測試",
                role=UserRole.member)
    db.add(user)
    db.flush()

    def attempt(order, method, actor=None):
        # 用關鍵字傳參 —— 這個函式有存取碼參數，位置對錯很容易踩到
        try:
            return change_payment_method(
                order.order_no, PaymentMethodUpdate(payment_method=method),
                t=order.access_token, db=db, user=actor,
            ), None
        except HTTPException as exc:
            return None, exc.detail

    # 一般情況：信用卡失敗後改 ATM
    order = make_order(db, order_no="SWITCH000000000001", user_id=user.id,
                       payment_status=PaymentStatus.failed,
                       payment_no="9999888877776666", payment_bank_code="808")
    db.commit()
    result, err = attempt(order, PaymentMethod.atm, user)
    check("可以從失敗的信用卡改成 ATM", err is None, str(err))
    check("付款方式真的換了", result and result.payment_method == PaymentMethod.atm)
    check("狀態回到未付款", result and result.payment_status == PaymentStatus.unpaid)
    check("舊的虛擬帳號被清掉", result and result.payment_no is None)
    check("舊的銀行代碼被清掉", result and result.payment_bank_code is None)

    # 換成一樣的
    _, err = attempt(order, PaymentMethod.atm, user)
    check("換成同一種會被擋", err is not None and "相同" in str(err), str(err))

    # 已付款
    paid = make_order(db, order_no="PAIDSW000000000001", user_id=user.id,
                      payment_status=PaymentStatus.paid)
    db.commit()
    _, err = attempt(paid, PaymentMethod.atm, user)
    check("已付款的不能改", err is not None, str(err))

    # 已取消
    cancelled = make_order(db, order_no="CANCSW000000000001", user_id=user.id,
                           status=OrderStatus.cancelled)
    db.commit()
    _, err = attempt(cancelled, PaymentMethod.atm, user)
    check("已取消的不能改", err is not None, str(err))

    # 已建立物流單
    shipping = make_order(db, order_no="SHIPSW000000000001", user_id=user.id,
                          logistics_status=LogisticsStatus.created)
    db.commit()
    _, err = attempt(shipping, PaymentMethod.atm, user)
    check("已建物流單的不能改", err is not None, str(err))

    # 別人的訂單。存取碼是這筆訂單的擁有者才知道的，
    # 所以這裡刻意不帶碼，模擬「只知道訂單編號」的攻擊者。
    def attempt_without_token(order, method, actor=None):
        try:
            return change_payment_method(
                order.order_no, PaymentMethodUpdate(payment_method=method),
                t=None, db=db, user=actor,
            ), None
        except HTTPException as exc:
            return None, exc.detail

    other = User(email="b@example.com", hashed_password="x", name="別人", role=UserRole.member)
    db.add(other)
    db.flush()
    mine = make_order(db, order_no="OWNER0000000000001", user_id=user.id)
    db.commit()
    _, err = attempt_without_token(mine, PaymentMethod.atm, other)
    check("別人不能改我的訂單", err is not None, str(err))
    _, err = attempt_without_token(mine, PaymentMethod.atm, None)
    check("沒登入又沒存取碼不能改", err is not None, str(err))

    # 訪客訂單沒有帳號可綁，只能靠存取碼
    guest = make_order(db, order_no="GUEST0000000000001", user_id=None)
    db.commit()
    _, err = attempt(guest, PaymentMethod.atm, None)
    check("訪客帶對存取碼可以改", err is None, str(err))
    _, err = attempt_without_token(guest, PaymentMethod.atm, None)
    check("訪客訂單沒帶碼也不能改", err is not None, str(err))

    # 郵局不支援貨到付款
    post = make_order(db, order_no="POSTSW000000000001", user_id=user.id,
                      shipping_method=ShippingMethod.home_post)
    db.commit()
    _, err = attempt(post, PaymentMethod.cod, user)
    check("郵局訂單不能改成貨到付款", err is not None, str(err))
    db.close()


def test_cod_fee_recalculation():
    print("\n[換成貨到付款時的金額重算]")
    from app.routers.orders import change_payment_method
    from app.schemas import PaymentMethodUpdate

    db = fresh_db()
    db.add(SiteSetting(key="cod_fee", value="30"))
    db.commit()

    order = make_order(db, order_no="CODFEE000000000001",
                       subtotal=1000, shipping_fee=70, total_amount=1070)
    db.commit()

    updated = change_payment_method(
        order.order_no, PaymentMethodUpdate(payment_method=PaymentMethod.cod),
        t=order.access_token, db=db, user=None,
    )
    check("換成貨到付款要加手續費",
          float(updated.total_amount) == 1100, f"算出 {updated.total_amount}")
    check("手續費併進運費欄位",
          float(updated.shipping_fee) == 100, f"算出 {updated.shipping_fee}")
    check("標記為代收貨款", updated.is_collection is True)

    back = change_payment_method(
        order.order_no, PaymentMethodUpdate(payment_method=PaymentMethod.credit),
        t=order.access_token, db=db, user=None,
    )
    check("換回信用卡要扣掉手續費",
          float(back.total_amount) == 1070, f"算出 {back.total_amount}")
    check("運費也還原", float(back.shipping_fee) == 70, f"算出 {back.shipping_fee}")
    check("取消代收貨款標記", back.is_collection is False)
    db.close()


def test_decorate():
    print("\n[繳費期限與可否重新付款]")
    from app.routers.orders import _decorate

    db = fresh_db()
    created = datetime(2026, 8, 17, 12, 0, 0)

    cases = [
        ("未付款的信用卡訂單", dict(payment_status=PaymentStatus.unpaid), True, True),
        ("已取號的 ATM 訂單",
         dict(payment_method=PaymentMethod.atm, payment_status=PaymentStatus.pending), True, True),
        ("付款失敗", dict(payment_status=PaymentStatus.failed), True, True),
        ("已付款", dict(payment_status=PaymentStatus.paid), False, False),
        ("貨到付款", dict(payment_method=PaymentMethod.cod), False, False),
        ("已取消", dict(status=OrderStatus.cancelled), False, False),
    ]
    for name, kw, want_deadline, want_retry in cases:
        order = make_order(db, order_no=f"D{name[:16]}", created_at=created, **kw)
        _decorate(order, 3)
        check(f"{name}：期限{'有' if want_deadline else '無'}",
              bool(order.payment_deadline) == want_deadline, str(order.payment_deadline))
        check(f"{name}：{'可' if want_retry else '不可'}重新付款",
              order.can_retry_payment == want_retry)
        if want_deadline:
            check(f"{name}：期限 = 下單 + 3 天",
                  order.payment_deadline == created + timedelta(days=3))

    # 關掉自動取消時不該顯示期限
    order = make_order(db, order_no="NODEADLINE0000001", created_at=created)
    _decorate(order, 0)
    check("保留天數為 0 時不顯示期限", order.payment_deadline is None)
    check("保留天數為 0 仍可重新付款", order.can_retry_payment is True)

    check("標籤有翻成中文", order.shipping_method_label == "7-ELEVEN 超商取貨",
          str(order.shipping_method_label))
    db.close()


def test_maps_complete():
    print("\n[設定與對應表的完整性]")
    for method in ShippingMethod:
        check(f"{method.value} 在 SHIPPING_MAP 裡", method.value in SHIPPING_MAP)
    for method in PaymentMethod:
        check(f"{method.value} 在 PAYMENT_MAP 裡", method.value in PAYMENT_MAP)

    needed = {
        "shipping_fee_cvs", "shipping_fee_cvs_hilife", "shipping_fee_home",
        "shipping_fee_home_cold", "shipping_fee_home_post", "unpaid_expire_days",
    }
    missing = needed - set(SHIPPING_DEFAULTS)
    check("運費設定的預設值都在", not missing, str(missing))

    # 綠界 C2C 子類型必須是官方認得的那幾組
    valid_subtypes = {"UNIMARTC2C", "FAMIC2C", "HILIFEC2C", "OKMARTC2C", "TCAT", "POST",
                      "UNIMART", "FAMI", "HILIFE", "ECAN"}
    for value, (ltype, sub_type, label, _) in SHIPPING_MAP.items():
        check(f"{label} 的子類型 {sub_type} 合法", sub_type in valid_subtypes)
        check(f"{label} 的物流類型合法", ltype in ("CVS", "HOME"))


if __name__ == "__main__":
    print("=" * 60)
    print("未付款處理與運費計算測試")
    print("=" * 60)
    for fn in (
        test_shipping_fees, test_combination_rules, test_expire_days,
        test_trade_no, test_find_order, test_expire_unpaid,
        test_restore_stock_on_manual_cancel, test_change_payment_method,
        test_cod_fee_recalculation, test_decorate, test_maps_complete,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
