"""運費計算與寄件人資訊。設定值都存在 site_settings，工作人員可於後台調整。"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import PAYMENT_MAP, SHIPPING_MAP, PaymentMethod, ShippingMethod, SiteSetting, Temperature

# 預設值（後台沒設定時使用）
SHIPPING_DEFAULTS: dict[str, str] = {
    "shipping_fee_cvs": "70",             # 超商取貨運費
    "shipping_fee_home": "160",           # 宅配運費（常溫）
    "shipping_fee_home_cold": "250",      # 宅配運費（冷藏／冷凍加價後的總運費）
    "free_shipping_threshold": "0",       # 滿額免運門檻，0 = 不提供免運
    "cod_fee": "0",                       # 貨到付款手續費（加在買家帳上）
    "sender_name": "",                    # 寄件人姓名（2~5 個中文字，不可含數字符號）
    "sender_phone": "",
    "sender_cellphone": "",
    "sender_zipcode": "",
    "sender_address": "",
}

TEMPERATURE_LABELS = {
    Temperature.normal.value: "常溫",
    Temperature.refrigerated.value: "冷藏",
    Temperature.frozen.value: "冷凍",
}


def get_shipping_settings(db: Session) -> dict[str, str]:
    values = dict(SHIPPING_DEFAULTS)
    rows = db.query(SiteSetting).filter(SiteSetting.key.in_(list(SHIPPING_DEFAULTS))).all()
    for row in rows:
        if row.value not in (None, ""):
            values[row.key] = row.value
    return values


def _number(values: dict[str, str], key: str) -> float:
    try:
        return float(values.get(key) or 0)
    except (TypeError, ValueError):
        return float(SHIPPING_DEFAULTS.get(key, 0) or 0)


def calc_shipping_fee(
    db: Session,
    subtotal: float,
    shipping_method: ShippingMethod | str,
    temperature: str = Temperature.normal.value,
) -> tuple[float, bool]:
    """計算運費，回傳 (運費, 是否達免運門檻)。"""
    values = get_shipping_settings(db)
    method = shipping_method.value if isinstance(shipping_method, ShippingMethod) else shipping_method
    logistics_type = SHIPPING_MAP.get(method, ("CVS",))[0]

    if logistics_type == "HOME":
        cold = temperature in (Temperature.refrigerated.value, Temperature.frozen.value)
        fee = _number(values, "shipping_fee_home_cold" if cold else "shipping_fee_home")
    else:
        fee = _number(values, "shipping_fee_cvs")

    threshold = _number(values, "free_shipping_threshold")
    if threshold > 0 and subtotal >= threshold:
        return 0.0, True
    return fee, False


def calc_cod_fee(db: Session, payment_method: PaymentMethod | str) -> float:
    method = payment_method.value if isinstance(payment_method, PaymentMethod) else payment_method
    if method != PaymentMethod.cod.value:
        return 0.0
    return _number(get_shipping_settings(db), "cod_fee")


def shipping_label(method: ShippingMethod | str) -> str:
    key = method.value if isinstance(method, ShippingMethod) else method
    return SHIPPING_MAP.get(key, ("", "", key, False))[2]


def payment_label(method: PaymentMethod | str) -> str:
    key = method.value if isinstance(method, PaymentMethod) else method
    return PAYMENT_MAP.get(key, ("", key))[1]


def validate_combination(
    shipping_method: ShippingMethod | str,
    payment_method: PaymentMethod | str,
    subtotal: float,
    temperature: str = Temperature.normal.value,
) -> str | None:
    """檢查送貨與付款方式的組合是否合法，有問題回傳錯誤訊息，沒問題回傳 None。"""
    ship = shipping_method.value if isinstance(shipping_method, ShippingMethod) else shipping_method
    pay = payment_method.value if isinstance(payment_method, PaymentMethod) else payment_method

    if ship not in SHIPPING_MAP:
        return "不支援的送貨方式"
    if pay not in PAYMENT_MAP:
        return "不支援的付款方式"

    logistics_type, sub_type, label, supports_cod = SHIPPING_MAP[ship]

    if pay == PaymentMethod.cod.value and not supports_cod:
        return f"「{label}」不支援貨到付款，請改選其他付款方式"

    # 超商取貨的商品金額上限為 20000 元（綠界規定）
    if logistics_type == "CVS" and subtotal > 20000:
        return "超商取貨單筆金額上限為 20,000 元，請改用宅配或分批下單"
    if logistics_type == "CVS" and subtotal < 1:
        return "訂單金額不正確"

    # 黑貓代收貨款上限同樣是 20000 元
    if logistics_type == "HOME" and pay == PaymentMethod.cod.value and subtotal > 20000:
        return "宅配貨到付款單筆金額上限為 20,000 元"

    # 中華郵政只能常溫
    if sub_type == "POST" and temperature != Temperature.normal.value:
        return "中華郵政宅配僅提供常溫，冷藏／冷凍請改選黑貓宅急便"

    return None
