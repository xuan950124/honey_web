import random
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import get_current_user, get_optional_user, require_staff
from ..ecpay import extract_zipcode
from .. import membership
from ..models import (
    PAYMENT_MAP, SHIPPING_MAP, LogisticsStatus, Order, OrderItem, OrderStatus,
    PaymentMethod, PaymentStatus, Product, ShippingMethod, Temperature, User,
)
from ..schemas import (
    CheckoutOptions, OrderCreate, OrderCreated, OrderOut, OrderStatusUpdate,
    PaymentMethodUpdate, PaymentOption, ShippingOption, ShippingQuoteIn,
    ShippingQuoteOut, SimpleMessage,
)
from ..shipping import (
    calc_cod_fee, calc_shipping_fee, get_shipping_settings, payment_label,
    shipping_label, unpaid_expire_days, validate_combination,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])

# 這些狀態代表「還在等買家付錢」，可以重新付款
RETRYABLE = {PaymentStatus.unpaid, PaymentStatus.pending, PaymentStatus.failed}


def _generate_order_no() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S") + str(random.randint(100, 999))


def _decorate(order: Order, days: int | None = None) -> Order:
    """補上給前端顯示用的中文標籤與繳費期限。

    繳費期限是「下單時間 + 保留天數」算出來的，不存進資料庫；
    這樣後台調整保留天數時，所有訂單會一起跟著改，不會有新舊兩套規則。
    """
    order.shipping_method_label = shipping_label(order.shipping_method)
    order.payment_method_label = payment_label(order.payment_method)

    deadline = None
    if (
        days
        and order.payment_method != PaymentMethod.cod
        and order.payment_status in RETRYABLE
        and order.status != OrderStatus.cancelled
    ):
        deadline = order.created_at + timedelta(days=days)
    order.payment_deadline = deadline
    order.can_retry_payment = bool(
        order.payment_method != PaymentMethod.cod
        and order.payment_status in RETRYABLE
        and order.status != OrderStatus.cancelled
    )
    return order


def _decorate_all(db: Session, orders: list[Order]) -> list[Order]:
    days = unpaid_expire_days(db)
    return [_decorate(o, days) for o in orders]


def _restore_stock(db: Session, order: Order) -> None:
    """把訂單佔用的庫存還回去。用旗標防止重複回補。"""
    if order.stock_restored:
        return
    for item in order.items:
        if item.product_id:
            product = db.get(Product, item.product_id)
            if product:
                product.stock = (product.stock or 0) + item.quantity
    order.stock_restored = True


def expire_unpaid_orders(db: Session) -> list[Order]:
    """把逾期未付款的訂單自動取消，並回補庫存。

    只處理「線上付款但一直沒付」的訂單。貨到付款沒有付款期限，
    已建立物流單的也不動 —— 那代表工作人員已經在處理了，
    自動取消會讓帳跟實際出貨對不起來。
    """
    days = unpaid_expire_days(db)
    if days <= 0:
        return []

    cutoff = datetime.now() - timedelta(days=days)
    stale = (
        db.query(Order).options(joinedload(Order.items))
        .filter(
            Order.created_at < cutoff,
            Order.status == OrderStatus.pending,
            Order.payment_status.in_(list(RETRYABLE)),
            Order.payment_method != PaymentMethod.cod,
            Order.logistics_status == LogisticsStatus.none,
        )
        .all()
    )
    for order in stale:
        order.status = OrderStatus.cancelled
        order.cancel_reason = f"超過 {days} 天未完成付款，系統自動取消"
        _restore_stock(db, order)
        membership.revoke_spending(db, order)
    if stale:
        db.commit()
    return stale


# ------------------------------------------------------------------ 結帳選項

@router.get("/checkout-options", response_model=CheckoutOptions)
def checkout_options(db: Session = Depends(get_db)):
    """前端結帳頁用來取得可選的送貨／付款方式與運費，避免在前端寫死。"""
    cfg = get_shipping_settings(db)

    def fee_of(method: str) -> float:
        amount, _ = calc_shipping_fee(db, 0, method)
        return amount

    fees = [fee_of(v) for v in SHIPPING_MAP]
    cheapest = min(fees) if fees else 0

    NOTES = {
        "HILIFEC2C": "最省運費的選擇，單件 5 公斤以內",
        "UNIMARTC2C": "門市最多，10 公斤以內",
        "FAMIC2C": "門市多，10 公斤以內",
        "POST": "只有常溫，不含離島；多罐一起買最划算",
        "TCAT": "隔日到府，可指定冷藏／冷凍",
    }

    shipping = []
    for value, (ltype, sub_type, label, supports_cod) in SHIPPING_MAP.items():
        note = NOTES.get(sub_type)
        if ltype == "CVS":
            note = f"{note}．單筆上限 20,000 元" if note else "單筆上限 20,000 元"
        shipping.append(ShippingOption(
            value=value, label=label, kind="cvs" if ltype == "CVS" else "home",
            fee=fee_of(value), supports_cod=supports_cod,
            supports_temperature=(sub_type == "TCAT"), note=note,
            is_cheapest=(fee_of(value) <= cheapest),
        ))

    payment_notes = {
        PaymentMethod.credit.value: "由綠界處理，卡號不會經過本站",
        PaymentMethod.atm.value: "取號後 3 天內完成轉帳",
        PaymentMethod.cvs_code.value: "取得代碼後 3 天內至超商繳費",
        PaymentMethod.cod.value: "取貨時付款，僅限支援的送貨方式",
    }
    payment = [
        PaymentOption(value=v, label=lbl, note=payment_notes.get(v))
        for v, (_, lbl) in PAYMENT_MAP.items()
    ]

    return CheckoutOptions(
        shipping=shipping,
        payment=payment,
        free_shipping_threshold=float(cfg.get("free_shipping_threshold") or 0),
        cod_fee=float(cfg.get("cod_fee") or 0),
        ecpay_env=settings.ECPAY_ENV,
        backend_base_url=settings.BACKEND_BASE_URL.rstrip('/'),
    )


@router.post("/quote", response_model=ShippingQuoteOut)
def quote(
    payload: ShippingQuoteIn,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """試算金額，讓買家在送出訂單前就看得到會員折扣與折價券的效果。"""
    fee, is_free = calc_shipping_fee(
        db, payload.subtotal, payload.shipping_method, payload.temperature
    )
    cod = calc_cod_fee(db, payload.payment_method)
    cfg = get_shipping_settings(db)

    tier = membership.current_tier(db, user)
    percent = float(tier.discount_percent) if tier else 0.0
    member_discount = round(payload.subtotal * percent / 100, 2)
    goods_after_member = payload.subtotal - member_discount

    coupon_discount = 0.0
    coupon_error = None
    coupon_code = None
    if payload.coupon_code:
        coupon, err = membership.find_coupon(db, user, payload.coupon_code)
        if err:
            coupon_error = err
        else:
            coupon_discount, fee, calc_err = membership.calc_discount(
                coupon, goods_after_member, fee
            )
            if calc_err:
                coupon_error = calc_err
                coupon_discount = 0.0
            else:
                coupon_code = coupon.code

    total = goods_after_member - coupon_discount + fee + cod
    return ShippingQuoteOut(
        subtotal=payload.subtotal,
        member_discount=member_discount,
        member_discount_percent=percent,
        member_tier_name=tier.name if tier else None,
        coupon_code=coupon_code,
        coupon_discount=coupon_discount,
        coupon_error=coupon_error,
        shipping_fee=fee,
        cod_fee=cod,
        total=max(0.0, round(total, 2)),
        free_shipping_threshold=float(cfg.get("free_shipping_threshold") or 0),
        is_free_shipping=is_free,
    )


# ------------------------------------------------------------------ 建立訂單

@router.post("", response_model=OrderCreated, status_code=201)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="購物車是空的")

    logistics_type = SHIPPING_MAP[payload.shipping_method.value][0]

    # 依送貨方式檢查必填欄位
    if logistics_type == "CVS":
        if not payload.cvs_store_id:
            raise HTTPException(status_code=400, detail="請先選擇取貨門市")
    else:
        if not payload.receiver_address or len(payload.receiver_address.strip()) < 6:
            raise HTTPException(status_code=400, detail="請填寫完整的收件地址（至少 6 個字）")

    # 同一個商品可能被送兩行（前端有 bug，或有人手動改請求想繞過庫存檢查）。
    # 先合併再檢查，不然「庫存 5 組」可以用兩行各 3 組通過每一行的檢查。
    wanted: dict[int, int] = {}
    for line in payload.items:
        wanted[line.product_id] = wanted.get(line.product_id, 0) + line.quantity

    # 計算商品小計並鎖定當下價格
    subtotal = 0.0
    lines: list[OrderItem] = []
    for product_id, quantity in wanted.items():
        product = db.get(Product, product_id)
        if not product or not product.is_active:
            raise HTTPException(status_code=400, detail=f"商品不存在或已下架（ID {product_id}）")
        if product.stock is not None and product.stock < quantity:
            remaining = max(0, product.stock)
            detail = (
                f"「{product.name}」已經售完，請先移除"
                if remaining == 0
                else f"「{product.name}」庫存只剩 {remaining} 組，你選了 {quantity} 組，請調整數量"
            )
            raise HTTPException(status_code=400, detail=detail)
        unit_price = float(product.price)
        subtotal += unit_price * quantity
        lines.append(OrderItem(
            product_id=product.id, product_name=product.name,
            unit_price=unit_price, quantity=quantity,
        ))

    # 檢查送貨與付款方式的組合
    error = validate_combination(
        payload.shipping_method, payload.payment_method, subtotal, payload.temperature
    )
    if error:
        raise HTTPException(status_code=400, detail=error)

    shipping_fee, _ = calc_shipping_fee(
        db, subtotal, payload.shipping_method, payload.temperature
    )
    cod_fee = calc_cod_fee(db, payload.payment_method)

    # 會員等級折扣（沒登入就沒有）
    tier = membership.current_tier(db, user)
    member_discount = round(subtotal * float(tier.discount_percent) / 100, 2) if tier else 0.0
    goods_after_member = subtotal - member_discount

    # 折價券。金額一律在後端重算，不信任前端傳來的數字。
    coupon = None
    coupon_discount = 0.0
    if payload.coupon_code:
        coupon, err = membership.find_coupon(db, user, payload.coupon_code)
        if err:
            raise HTTPException(status_code=400, detail=err)
        coupon_discount, shipping_fee, calc_err = membership.calc_discount(
            coupon, goods_after_member, shipping_fee
        )
        if calc_err:
            raise HTTPException(status_code=400, detail=calc_err)

    total = goods_after_member - coupon_discount + shipping_fee + cod_fee
    total = max(0.0, round(total, 2))

    # 含運費後仍要符合超商／代收的金額上限
    if logistics_type == "CVS" and total > 20000:
        raise HTTPException(status_code=400, detail="含運費後超過超商取貨 20,000 元上限，請改用宅配")

    is_cod = payload.payment_method == PaymentMethod.cod

    # 超商取貨沒有街道地址，改存門市名稱與地址，訂單頁與託運單顯示才有意義
    if logistics_type == "CVS":
        receiver_address = " ".join(
            p for p in [payload.cvs_store_name, payload.cvs_address] if p
        ).strip() or f"超商門市 {payload.cvs_store_id}"
        receiver_zipcode = None
    else:
        receiver_address = (payload.receiver_address or "").strip()
        receiver_zipcode = payload.receiver_zipcode or extract_zipcode(receiver_address)

    order = Order(
        order_no=_generate_order_no(),
        user_id=user.id if user else None,
        receiver_name=payload.receiver_name,
        receiver_phone=payload.receiver_phone,
        receiver_address=receiver_address,
        receiver_zipcode=receiver_zipcode,
        note=payload.note,
        subtotal=subtotal,
        member_discount=member_discount,
        coupon_code=coupon.code if coupon else None,
        coupon_discount=coupon_discount,
        shipping_fee=shipping_fee + cod_fee,
        total_amount=total,
        status=OrderStatus.pending,
        shipping_method=payload.shipping_method,
        payment_method=payload.payment_method,
        payment_status=PaymentStatus.unpaid,
        is_collection=is_cod,
        temperature=payload.temperature or Temperature.normal.value,
        specification=payload.specification or "0001",
    )

    if logistics_type == "CVS":
        order.cvs_store_id = payload.cvs_store_id
        order.cvs_store_name = payload.cvs_store_name
        order.cvs_address = payload.cvs_address
        order.cvs_telephone = payload.cvs_telephone
        order.cvs_outside = payload.cvs_outside

    for item in lines:
        order.items.append(item)
        product = db.get(Product, item.product_id)
        if product:
            product.stock = max(0, (product.stock or 0) - item.quantity)

    db.add(order)
    db.flush()
    membership.redeem(db, coupon, order.order_no)

    # 貨到付款沒有線上付款流程，訂單成立即視為付款完成（取貨時付現）
    db.commit()
    db.refresh(order)

    payment_url = None
    if not is_cod:
        payment_url = f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/payments/{order.order_no}/checkout"

    return OrderCreated(order=OrderOut.model_validate(_decorate(order)), payment_url=payment_url)


# ------------------------------------------------------------------ 查詢

@router.get("/my", response_model=list[OrderOut])
def my_orders(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    orders = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.user_id == user.id).order_by(Order.id.desc()).all()
    )
    return _decorate_all(db, orders)


@router.get("/by-no/{order_no}", response_model=OrderOut)
def get_order_by_no(order_no: str, db: Session = Depends(get_db)):
    """依訂單編號查詢。付款完成後導回的訂單頁會用到（訪客下單也看得到）。"""
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到這筆訂單")
    return _decorate(order, unpaid_expire_days(db))


@router.get("", response_model=list[OrderOut], dependencies=[Depends(require_staff)])
def all_orders(db: Session = Depends(get_db), status: OrderStatus | None = None):
    q = db.query(Order).options(joinedload(Order.items))
    if status:
        q = q.filter(Order.status == status)
    return _decorate_all(db, q.order_by(Order.id.desc()).all())


# ------------------------------------------------------------------ 付款問題處理

def _load_order(db: Session, order_no: str) -> Order:
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到這筆訂單")
    return order


@router.patch("/by-no/{order_no}/payment-method", response_model=OrderOut)
def change_payment_method(
    order_no: str,
    payload: PaymentMethodUpdate,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """未付款的訂單可以換一種付款方式再試一次。

    信用卡被拒絕、ATM 忘記轉帳、超商代碼過期都用這條路回來，
    不用重新下單（重下單會丟失折價券，也會讓庫存被扣兩次）。
    """
    order = _load_order(db, order_no)

    if order.user_id and (not user or user.id != order.user_id):
        raise HTTPException(status_code=403, detail="這筆訂單不屬於這個帳號")
    if order.status == OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="訂單已取消，無法變更付款方式")
    if order.payment_status == PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="這筆訂單已經付款完成")
    if order.logistics_status != LogisticsStatus.none:
        raise HTTPException(
            status_code=400,
            detail="已經建立物流單，付款方式無法再變更，請直接聯絡我們",
        )
    if order.payment_method == payload.payment_method:
        raise HTTPException(status_code=400, detail="和目前的付款方式相同")

    error = validate_combination(
        order.shipping_method, payload.payment_method,
        float(order.subtotal or 0), order.temperature,
    )
    if error:
        raise HTTPException(status_code=400, detail=error)

    # 貨到付款的手續費包在 shipping_fee 裡，換方式時要把差額重算回來
    old_cod = calc_cod_fee(db, order.payment_method)
    new_cod = calc_cod_fee(db, payload.payment_method)
    order.shipping_fee = float(order.shipping_fee or 0) - old_cod + new_cod
    order.total_amount = max(0.0, round(float(order.total_amount or 0) - old_cod + new_cod, 2))

    order.payment_method = payload.payment_method
    order.is_collection = payload.payment_method == PaymentMethod.cod
    # 舊的虛擬帳號／繳費代碼作廢，不然買家可能對著過期的號碼繳費
    order.payment_no = None
    order.payment_bank_code = None
    order.payment_expire_date = None
    order.payment_status = PaymentStatus.unpaid
    order.payment_message = None

    db.commit()
    db.refresh(order)
    return _decorate(order, unpaid_expire_days(db))


@router.post("/by-no/{order_no}/cancel", response_model=OrderOut)
def cancel_my_order(
    order_no: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """買家自行取消還沒付款的訂單。

    刻意要求登入且必須是訂單本人 —— 訂單編號是時間戳，猜得到，
    如果只憑編號就能取消，別人可以惡意刪掉你的訂單。
    訪客訂單請走客服。
    """
    order = _load_order(db, order_no)
    if order.user_id != user.id:
        raise HTTPException(status_code=403, detail="這筆訂單不屬於這個帳號")
    if order.status == OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="訂單已經取消了")
    if order.payment_status == PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="已付款的訂單請聯絡我們協助處理")
    if order.logistics_status != LogisticsStatus.none:
        raise HTTPException(status_code=400, detail="已經在出貨流程中，請聯絡我們協助處理")

    order.status = OrderStatus.cancelled
    order.cancel_reason = "買家自行取消"
    _restore_stock(db, order)
    membership.revoke_spending(db, order)
    db.commit()
    db.refresh(order)
    return _decorate(order, unpaid_expire_days(db))


@router.post("/expire-unpaid", response_model=SimpleMessage,
             dependencies=[Depends(require_staff)])
def expire_unpaid(db: Session = Depends(get_db)):
    """手動清一次逾期未付款的訂單。系統本來也會每小時自動跑一次。"""
    days = unpaid_expire_days(db)
    if days <= 0:
        return SimpleMessage(
            ok=False,
            message="目前設定為「不自動取消」。要啟用請到網站設定填寫未付款保留天數。",
        )
    cancelled = expire_unpaid_orders(db)
    if not cancelled:
        return SimpleMessage(message=f"沒有超過 {days} 天未付款的訂單，不需要清理。")
    return SimpleMessage(
        message=f"已取消 {len(cancelled)} 筆逾期未付款訂單，庫存也已經還原。",
    )


@router.patch("/{order_id}/status", response_model=OrderOut,
              dependencies=[Depends(require_staff)])
def update_status(order_id: int, payload: OrderStatusUpdate, db: Session = Depends(get_db)):
    order = (
        db.query(Order).options(joinedload(Order.items)).filter(Order.id == order_id).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")

    order.status = payload.status

    # 貨到付款沒有線上付款通知，改成「已完成」時視為收到款項才計入累積消費
    if payload.status == OrderStatus.completed:
        if order.payment_method == PaymentMethod.cod:
            order.payment_status = PaymentStatus.paid
            order.paid_at = order.paid_at or datetime.now()
        membership.record_spending(db, order)
    elif payload.status == OrderStatus.cancelled:
        # 取消訂單就把業績扣回來（已經發出去的券不收回，避免爭議），庫存也要還原
        membership.revoke_spending(db, order)
        _restore_stock(db, order)

    db.commit()
    db.refresh(order)
    return _decorate(order, unpaid_expire_days(db))
