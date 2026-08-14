import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import get_current_user, get_optional_user, require_staff
from ..ecpay import extract_zipcode
from ..models import (
    PAYMENT_MAP, SHIPPING_MAP, Order, OrderItem, OrderStatus, PaymentMethod,
    PaymentStatus, Product, ShippingMethod, Temperature, User,
)
from ..schemas import (
    CheckoutOptions, OrderCreate, OrderCreated, OrderOut, OrderStatusUpdate,
    PaymentOption, ShippingOption, ShippingQuoteIn, ShippingQuoteOut,
)
from ..shipping import (
    calc_cod_fee, calc_shipping_fee, get_shipping_settings, payment_label,
    shipping_label, validate_combination,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _generate_order_no() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S") + str(random.randint(100, 999))


def _decorate(order: Order) -> Order:
    """補上給前端顯示用的中文標籤。"""
    order.shipping_method_label = shipping_label(order.shipping_method)
    order.payment_method_label = payment_label(order.payment_method)
    return order


# ------------------------------------------------------------------ 結帳選項

@router.get("/checkout-options", response_model=CheckoutOptions)
def checkout_options(db: Session = Depends(get_db)):
    """前端結帳頁用來取得可選的送貨／付款方式與運費，避免在前端寫死。"""
    cfg = get_shipping_settings(db)

    def fee_of(method: str) -> float:
        amount, _ = calc_shipping_fee(db, 0, method)
        return amount

    shipping = []
    for value, (ltype, sub_type, label, supports_cod) in SHIPPING_MAP.items():
        note = None
        if ltype == "CVS":
            note = "單筆金額上限 20,000 元"
        elif sub_type == "POST":
            note = "僅提供常溫，不含離島"
        shipping.append(ShippingOption(
            value=value, label=label, kind="cvs" if ltype == "CVS" else "home",
            fee=fee_of(value), supports_cod=supports_cod,
            supports_temperature=(sub_type == "TCAT"), note=note,
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
def quote(payload: ShippingQuoteIn, db: Session = Depends(get_db)):
    """試算運費，讓買家在還沒送出訂單前就看得到金額。"""
    fee, is_free = calc_shipping_fee(
        db, payload.subtotal, payload.shipping_method, payload.temperature
    )
    cod = calc_cod_fee(db, payload.payment_method)
    cfg = get_shipping_settings(db)
    return ShippingQuoteOut(
        subtotal=payload.subtotal,
        shipping_fee=fee,
        cod_fee=cod,
        total=payload.subtotal + fee + cod,
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

    # 計算商品小計並鎖定當下價格
    subtotal = 0.0
    lines: list[OrderItem] = []
    for line in payload.items:
        product = db.get(Product, line.product_id)
        if not product or not product.is_active:
            raise HTTPException(status_code=400, detail=f"商品不存在或已下架（ID {line.product_id}）")
        if product.stock is not None and product.stock < line.quantity:
            raise HTTPException(status_code=400, detail=f"「{product.name}」庫存不足")
        unit_price = float(product.price)
        subtotal += unit_price * line.quantity
        lines.append(OrderItem(
            product_id=product.id, product_name=product.name,
            unit_price=unit_price, quantity=line.quantity,
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
    total = subtotal + shipping_fee + cod_fee

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
    return [_decorate(o) for o in orders]


@router.get("/by-no/{order_no}", response_model=OrderOut)
def get_order_by_no(order_no: str, db: Session = Depends(get_db)):
    """依訂單編號查詢。付款完成後導回的訂單頁會用到（訪客下單也看得到）。"""
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到這筆訂單")
    return _decorate(order)


@router.get("", response_model=list[OrderOut], dependencies=[Depends(require_staff)])
def all_orders(db: Session = Depends(get_db), status: OrderStatus | None = None):
    q = db.query(Order).options(joinedload(Order.items))
    if status:
        q = q.filter(Order.status == status)
    return [_decorate(o) for o in q.order_by(Order.id.desc()).all()]


@router.patch("/{order_id}/status", response_model=OrderOut,
              dependencies=[Depends(require_staff)])
def update_status(order_id: int, payload: OrderStatusUpdate, db: Session = Depends(get_db)):
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")
    order.status = payload.status
    db.commit()
    db.refresh(order)
    return _decorate(order)
