import random
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import get_current_user, get_optional_user, require_staff
from ..ecpay import extract_zipcode
from .. import membership
from ..models import (
    PAYMENT_MAP, SHIPPING_MAP, LogisticsStatus, Order, OrderItem, OrderStatus,
    PaymentMethod, PaymentStatus, Product, ShippingMethod, Temperature, User, UserRole,
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


def new_access_token() -> str:
    """訂單頁的存取碼。用 secrets 而不是 random —— random 是可預測的偽隨機。"""
    return secrets.token_urlsafe(16)


def can_view_order(order: Order, user: User | None, token: str | None) -> bool:
    """這個人可以看這筆訂單嗎？

    三種情況允許：工作人員、訂單本人、帶對存取碼。
    訪客下單沒有帳號，只能靠存取碼 —— 那組碼會放在付款完成後導回的網址裡。
    """
    if user and user.role == UserRole.staff:
        return True
    if user and order.user_id and order.user_id == user.id:
        return True
    if order.access_token and token and secrets.compare_digest(order.access_token, token):
        return True
    return False


# 訂單還「在買家手上」的狀態。只有這個狀態下才談得上付款與取消 ——
# 一旦出貨或完成，錢的事就該由工作人員在後台對帳處理，
# 不然會出現「已完成」卻同時叫客人去付款這種前後矛盾的畫面。
OPEN_STATUSES = {OrderStatus.pending}

# 給錯誤訊息用的中文狀態名。訊息裡寫 "completed" 客人看不懂
ORDER_STATUS_LABELS = {
    OrderStatus.pending: "待處理",
    OrderStatus.paid: "已付款",
    OrderStatus.shipped: "已出貨",
    OrderStatus.completed: "已完成",
    OrderStatus.cancelled: "已取消",
}


def _decorate(order: Order, days: int | None = None) -> Order:
    """補上給前端顯示用的中文標籤、繳費期限，以及這筆現在能做什麼。

    繳費期限是「下單時間 + 保留天數」算出來的，不存進資料庫；
    這樣後台調整保留天數時，所有訂單會一起跟著改，不會有新舊兩套規則。

    can_retry_payment / can_cancel 一律由後端算好給前端用。
    讓前端自己拼條件的話，兩邊遲早會不一致 ——
    畫面顯示「可以取消」但按下去被拒絕，比一開始就不顯示還糟。
    """
    order.shipping_method_label = shipping_label(order.shipping_method)
    order.payment_method_label = payment_label(order.payment_method)

    still_open = order.status in OPEN_STATUSES
    awaiting_payment = (
        order.payment_method != PaymentMethod.cod
        and order.payment_status in RETRYABLE
        and still_open
    )

    order.payment_deadline = (
        order.created_at + timedelta(days=days) if days and awaiting_payment else None
    )
    order.can_retry_payment = bool(awaiting_payment)

    # 可以取消的條件：還沒付款、還沒建物流單、狀態還在待處理。
    # 貨到付款也算 —— 那種訂單本來就是取貨時才付錢。
    order.can_cancel = bool(
        still_open
        and order.payment_status != PaymentStatus.paid
        and order.logistics_status == LogisticsStatus.none
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
    # 設定只查一次。以前每算一次運費就查一次資料庫，
    # 五種送貨方式算三輪等於十幾次查詢，同時有幾個人在結帳就把連線池吃光了。
    cfg = get_shipping_settings(db)

    fees = {v: calc_shipping_fee(db, 0, v, values=cfg)[0] for v in SHIPPING_MAP}
    cheapest = min(fees.values()) if fees else 0

    NOTES = {
        "HILIFEC2C": "最省運費的選擇，單件 5 公斤以內",
        "UNIMARTC2C": "門市最多，10 公斤以內",
        "FAMIC2C": "門市多，10 公斤以內",
        "POST": "只有常溫，不含離島；多罐一起買最划算",
        "TCAT": "隔日到府，可指定冷藏／冷凍",
    }

    payment_notes = {
        PaymentMethod.credit.value: "由綠界處理，卡號不會經過本站",
        PaymentMethod.atm.value: "取號後 3 天內完成轉帳",
        PaymentMethod.cvs_code.value: "取得代碼後 3 天內至超商繳費",
        PaymentMethod.cod.value: "取貨時付款，僅限支援的送貨方式",
    }

    # 「物流已正式、金流還在審核」時，只開放貨到付款。
    #
    # 這個組合代表店家已經在真的出貨了。如果還讓客人選信用卡，
    # 他會被帶到綠界的**測試**付款頁，刷了也收不到錢 ——
    # 客人以為買到了，你這邊卻沒有一毛錢進來，是最糟的狀況。
    #
    # 兩邊都還在測試時不擋，那是開發中的正常狀態，要能測所有付款方式。
    cod_only = settings.is_logistics_production and not settings.is_ecpay_production
    online_reason = "線上付款服務審核中，目前僅開放貨到付款" if cod_only else None

    payment = [
        PaymentOption(
            value=v, label=lbl, note=payment_notes.get(v),
            disabled=bool(cod_only and v != PaymentMethod.cod.value),
            disabled_reason=online_reason if v != PaymentMethod.cod.value else None,
        )
        for v, (_, lbl) in PAYMENT_MAP.items()
    ]

    shipping = []
    for value, (ltype, sub_type, label, supports_cod) in SHIPPING_MAP.items():
        note = NOTES.get(sub_type)
        if ltype == "CVS":
            note = f"{note}．單筆上限 20,000 元" if note else "單筆上限 20,000 元"

        # 只開放貨到付款、而這個送貨方式又不支援貨到付款時，它根本沒得選。
        #
        # 這一段是踩過坑才加的：原本只停用付款方式，前端就出現
        # 「這個送貨方式不能貨到付款 → 切回信用卡 → 信用卡被停用 → 切回貨到付款」
        # 的無限迴圈，每一輪都打一次試算 API，直接把資料庫連線池打爆。
        # 根本解是「不要留下一個無解的組合」。
        unavailable = cod_only and not supports_cod
        shipping.append(ShippingOption(
            value=value, label=label, kind="cvs" if ltype == "CVS" else "home",
            fee=fees[value], supports_cod=supports_cod,
            supports_temperature=(sub_type == "TCAT"), note=note,
            is_cheapest=(fees[value] <= cheapest and not unavailable),
            disabled=unavailable,
            disabled_reason=(
                "這個配送方式不支援貨到付款，線上付款服務審核通過後才能使用"
                if unavailable else None
            ),
        ))

    return CheckoutOptions(
        shipping=shipping,
        payment=payment,
        free_shipping_threshold=float(cfg.get("free_shipping_threshold") or 0),
        cod_fee=float(cfg.get("cod_fee") or 0),
        ecpay_env=settings.ECPAY_ENV,
        ecpay_status=settings.ecpay_status,
        backend_base_url=settings.BACKEND_BASE_URL.rstrip('/'),
    )


@router.post("/quote", response_model=ShippingQuoteOut)
def quote(
    payload: ShippingQuoteIn,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """試算金額，讓買家在送出訂單前就看得到會員折扣與折價券的效果。

    這支是全站被打最兇的 API —— 買家每動一下就會呼叫。
    設定只查一次，其餘都拿現成的算。
    """
    cfg = get_shipping_settings(db)
    fee, is_free = calc_shipping_fee(
        db, payload.subtotal, payload.shipping_method, payload.temperature, values=cfg
    )
    cod = calc_cod_fee(db, payload.payment_method, values=cfg)

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

        # 門市必須屬於選的那家超商。
        #
        # 門市代號是綁定超商的，7-11 的店號拿去建萊爾富的物流單，
        # 綠界會退回，運氣不好包裹會被送到錯的地方 —— 而且找不回來。
        # 前端換超商時會清掉門市，這裡是第二道：直接打 API 也擋得住。
        expected = SHIPPING_MAP[payload.shipping_method.value][1]
        got = (payload.cvs_sub_type or "").strip().upper()
        if got and got != expected:
            raise HTTPException(
                status_code=400,
                detail=f"你選的取貨門市不屬於「{shipping_label(payload.shipping_method)}」，"
                       "請重新選擇門市。",
            )
    else:
        if not payload.receiver_address or len(payload.receiver_address.strip()) < 6:
            raise HTTPException(status_code=400, detail="請填寫完整的收件地址（至少 6 個字）")

    # 工作人員可以買「還沒開放購買」的商品，用來測試整個結帳流程
    is_staff = bool(user and user.role == UserRole.staff)

    # 同一個商品可能被送兩行（前端有 bug，或有人手動改請求想繞過庫存檢查）。
    # 先合併再檢查，不然「庫存 5 組」可以用兩行各 3 組通過每一行的檢查。
    wanted: dict[int, int] = {}
    for line in payload.items:
        wanted[line.product_id] = wanted.get(line.product_id, 0) + line.quantity

    # 計算商品小計並鎖定當下價格。
    #
    # 這裡用 with_for_update() 把商品那幾列鎖住，直到這筆訂單 commit 為止。
    # 沒有鎖的話兩個人同時搶最後一組會變成「都讀到還有 1 組」→ 兩人都成立訂單 → 超賣。
    # 依 ID 排序再鎖是為了避免死鎖：兩筆訂單買同樣兩件商品但順序相反時，
    # 沒排序的話會互相等對方放手。
    subtotal = 0.0
    lines: list[OrderItem] = []
    locked: list[tuple[Product, int]] = []
    for product_id, quantity in sorted(wanted.items()):
        product = (
            db.query(Product).filter(Product.id == product_id).with_for_update().first()
        )
        if not product or not product.is_active:
            raise HTTPException(status_code=400, detail=f"商品不存在或已下架（ID {product_id}）")

        # 「看得到但還不能買」的商品。工作人員例外 ——
        # 那正是這個開關的用途：先把商品掛上去測完整個結帳流程，客人還買不到。
        if not product.is_purchasable and not is_staff:
            note = (product.unavailable_note or "").strip()
            raise HTTPException(
                status_code=400,
                detail=f"「{product.name}」{note or '目前尚未開放購買'}，請先從購物車移除。",
            )

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
        locked.append((product, quantity))
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

    # 金流還在審核、物流已正式時，線上付款一律擋掉。
    # 前端已經把選項停用了，但那只是畫面 —— 直接打 API 一樣要擋得住，
    # 不然會出現「客人刷了測試卡以為買到，店家一毛錢都沒收到」的狀況。
    if (settings.is_logistics_production and not settings.is_ecpay_production
            and payload.payment_method != PaymentMethod.cod):
        raise HTTPException(
            status_code=400,
            detail="線上付款服務仍在審核中，目前僅開放貨到付款。造成不便請見諒。",
        )

    cfg = get_shipping_settings(db)
    shipping_fee, _ = calc_shipping_fee(
        db, subtotal, payload.shipping_method, payload.temperature, values=cfg
    )
    cod_fee = calc_cod_fee(db, payload.payment_method, values=cfg)

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
        access_token=new_access_token(),
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

    # 扣庫存。用上面 with_for_update 鎖住的那幾列，不要再 db.get 一次 ——
    # 重新讀會拿到 identity map 裡的同一個物件沒錯，但寫得明確一點才不會有人
    # 之後把鎖拿掉卻沒發現這裡也失去保護。
    for product, quantity in locked:
        product.stock = max(0, (product.stock or 0) - quantity)

    db.add(order)
    db.flush()
    membership.redeem(db, coupon, order.order_no)

    # commit 之後鎖才釋放，所以「檢查庫存 → 扣庫存」是一個不可分割的動作
    db.commit()
    db.refresh(order)

    payment_url = None
    if not is_cod:
        base = settings.BACKEND_BASE_URL.rstrip('/')
        payment_url = (
            f"{base}/api/payments/{order.order_no}/checkout?t={order.access_token}"
        )

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
def get_order_by_no(
    order_no: str,
    t: str | None = Query(default=None, description="訂單存取碼"),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """依訂單編號查詢。付款完成後導回的訂單頁會用到（訪客下單也看得到）。

    需要「本人登入」或「帶對存取碼」才看得到 ——
    訂單裡有收件人姓名、電話、地址，不能只憑猜得到的訂單編號就撈出來。
    """
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    # 找不到、和沒權限一律回同一句。回「無權查看」等於告訴對方這個編號存在，
    # 那就變成可以拿來探測有哪些訂單。
    if not order or not can_view_order(order, user, t):
        raise HTTPException(status_code=404, detail="找不到這筆訂單，或連結已失效")
    return _decorate(order, unpaid_expire_days(db))


@router.get("", response_model=list[OrderOut], dependencies=[Depends(require_staff)])
def all_orders(db: Session = Depends(get_db), status: OrderStatus | None = None):
    q = db.query(Order).options(joinedload(Order.items))
    if status:
        q = q.filter(Order.status == status)
    return _decorate_all(db, q.order_by(Order.id.desc()).all())


# ------------------------------------------------------------------ 付款問題處理

def _load_order(db: Session, order_no: str, user: User | None = None,
                token: str | None = None) -> Order:
    """讀取訂單並檢查權限。沒權限一律當成找不到，避免被拿來探測訂單是否存在。"""
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order or not can_view_order(order, user, token):
        raise HTTPException(status_code=404, detail="找不到這筆訂單，或連結已失效")
    return order


@router.patch("/by-no/{order_no}/payment-method", response_model=OrderOut)
def change_payment_method(
    order_no: str,
    payload: PaymentMethodUpdate,
    t: str | None = Query(default=None, description="訂單存取碼"),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """未付款的訂單可以換一種付款方式再試一次。

    信用卡被拒絕、ATM 忘記轉帳、超商代碼過期都用這條路回來，
    不用重新下單（重下單會丟失折價券，也會讓庫存被扣兩次）。
    """
    order = _load_order(db, order_no, user, t)

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
    order = _load_order(db, order_no, user)
    if order.user_id != user.id:
        raise HTTPException(status_code=403, detail="這筆訂單不屬於這個帳號")
    if order.status == OrderStatus.cancelled:
        raise HTTPException(status_code=400, detail="訂單已經取消了")
    # 已出貨或已完成的訂單不能自助取消。
    # 這個檢查要跟 _decorate 算 can_cancel 的條件一致 ——
    # 只擋畫面上的按鈕是不夠的，直接打 API 一樣要擋得住。
    if order.status not in OPEN_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"這筆訂單已經是「{ORDER_STATUS_LABELS.get(order.status, order.status.value)}」，"
                   "無法自行取消。如果有問題請直接與我們聯絡，我們會協助處理。",
        )
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
        elif payload.mark_paid and order.payment_status != PaymentStatus.paid:
            # 工作人員明確勾了「同時註記已收款」才動付款狀態。
            # 不自動標記是刻意的 —— 出貨與收款是兩件事，
            # 系統偷偷幫你標成已付款，帳就對不出來了。
            order.payment_status = PaymentStatus.paid
            order.paid_at = order.paid_at or datetime.now()
            order.payment_message = None
        membership.record_spending(db, order)
    elif payload.status == OrderStatus.shipped and payload.mark_paid:
        if order.payment_status != PaymentStatus.paid:
            order.payment_status = PaymentStatus.paid
            order.paid_at = order.paid_at or datetime.now()
            order.payment_message = None
    elif payload.status == OrderStatus.cancelled:
        # 取消訂單就把業績扣回來（已經發出去的券不收回，避免爭議），庫存也要還原
        membership.revoke_spending(db, order)
        _restore_stock(db, order)

    db.commit()
    db.refresh(order)
    return _decorate(order, unpaid_expire_days(db))
