"""會員等級、累積消費與折價券。

設計重點：
  - 累積消費在「付款完成」時才計入，且用 Order.spending_counted 旗標確保只算一次
    （綠界的付款通知可能重送，狀態也可能被工作人員來回改）
  - 等級由累積消費即時判定，不另外存欄位，避免資料不同步
  - 折價券一張只能用一次，且發放時就寫死條件，之後改規則不影響已發出的券
"""
from __future__ import annotations

import secrets
import string
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .models import (
    Coupon, CouponKind, CouponRule, CouponTrigger, MemberTier, Order, User,
)

# 券號用不易看錯的字元（去掉 0/O、1/I 這類）
CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"


# ---------------------------------------------------------------- 會員等級

def list_tiers(db: Session) -> list[MemberTier]:
    return (
        db.query(MemberTier)
        .filter(MemberTier.is_active.is_(True))
        .order_by(MemberTier.min_spent, MemberTier.id)
        .all()
    )


def current_tier(db: Session, user: User | None) -> MemberTier | None:
    """依累積消費判定目前等級（取符合門檻中最高的那個）。"""
    if not user:
        return None
    spent = float(user.total_spent or 0)
    matched = [t for t in list_tiers(db) if spent >= float(t.min_spent)]
    return matched[-1] if matched else None


def next_tier(db: Session, user: User | None) -> MemberTier | None:
    """下一個還沒達到的等級，用來顯示「再消費多少可升級」。"""
    if not user:
        return None
    spent = float(user.total_spent or 0)
    pending = [t for t in list_tiers(db) if spent < float(t.min_spent)]
    return pending[0] if pending else None


def member_discount_percent(db: Session, user: User | None) -> float:
    tier = current_tier(db, user)
    return float(tier.discount_percent) if tier else 0.0


# ---------------------------------------------------------------- 發券

def _generate_code(db: Session) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(10))
        if not db.query(Coupon).filter(Coupon.code == code).first():
            return code
    raise RuntimeError("無法產生不重複的折價券代碼")


def _issue_from_rule(db: Session, user: User, rule: CouponRule) -> Coupon:
    """依規則發一張券。條件在發放當下寫死，之後改規則不影響已發出的券。"""
    coupon = Coupon(
        code=_generate_code(db),
        user_id=user.id,
        rule_id=rule.id,
        name=rule.name,
        kind=rule.kind,
        value=rule.value,
        min_order_amount=rule.min_order_amount,
        max_discount=rule.max_discount,
        expires_at=(
            datetime.now() + timedelta(days=int(rule.valid_days))
            if rule.valid_days and int(rule.valid_days) > 0
            else None
        ),
    )
    db.add(coupon)
    db.flush()
    return coupon


def _already_issued(db: Session, user: User, rule: CouponRule) -> bool:
    """同一個規則對同一位會員只發一次。"""
    return (
        db.query(Coupon)
        .filter(Coupon.user_id == user.id, Coupon.rule_id == rule.id)
        .first()
        is not None
    )


def issue_register_coupons(db: Session, user: User) -> list[Coupon]:
    """新會員完成信箱驗證時發放。

    刻意在「驗證後」而非「註冊當下」發放：
    否則有人用假信箱大量註冊就能一直領券。
    """
    rules = (
        db.query(CouponRule)
        .filter(
            CouponRule.trigger == CouponTrigger.register,
            CouponRule.is_active.is_(True),
        )
        .order_by(CouponRule.sort_order, CouponRule.id)
        .all()
    )
    return [_issue_from_rule(db, user, r) for r in rules if not _already_issued(db, user, r)]


def issue_milestone_coupons(db: Session, user: User) -> list[Coupon]:
    """累積消費達門檻時發放。一次可能跨過好幾個門檻。"""
    spent = float(user.total_spent or 0)
    rules = (
        db.query(CouponRule)
        .filter(
            CouponRule.trigger == CouponTrigger.total_spent,
            CouponRule.is_active.is_(True),
        )
        .order_by(CouponRule.threshold, CouponRule.id)
        .all()
    )
    issued = []
    for rule in rules:
        if spent >= float(rule.threshold) and not _already_issued(db, user, rule):
            issued.append(_issue_from_rule(db, user, rule))
    return issued


# ---------------------------------------------------------------- 累積消費

def record_spending(db: Session, order: Order) -> list[Coupon]:
    """把一筆訂單計入會員累積消費，並檢查有沒有達到發券門檻。

    只在付款完成時呼叫，且靠 spending_counted 旗標確保同一筆訂單只算一次。
    回傳這次新發放的折價券。
    """
    if order.spending_counted or not order.user_id:
        return []

    user = db.get(User, order.user_id)
    if not user:
        return []

    # 只計商品實付金額，運費不算業績
    amount = float(order.subtotal or 0) - float(order.member_discount or 0) \
        - float(order.coupon_discount or 0)
    amount = max(0.0, amount)

    user.total_spent = float(user.total_spent or 0) + amount
    order.spending_counted = True
    db.flush()

    return issue_milestone_coupons(db, user)


def revoke_spending(db: Session, order: Order) -> None:
    """訂單取消或退貨時把金額扣回來。已發出的券不收回（避免爭議）。"""
    if not order.spending_counted or not order.user_id:
        return
    user = db.get(User, order.user_id)
    if user:
        amount = float(order.subtotal or 0) - float(order.member_discount or 0) \
            - float(order.coupon_discount or 0)
        user.total_spent = max(0.0, float(user.total_spent or 0) - max(0.0, amount))
    order.spending_counted = False
    db.flush()


# ---------------------------------------------------------------- 折價券使用

def usable_coupons(db: Session, user: User | None) -> list[Coupon]:
    """會員目前可用的券（未使用且未過期）。"""
    if not user:
        return []
    now = datetime.now()
    return (
        db.query(Coupon)
        .filter(
            Coupon.user_id == user.id,
            Coupon.used_at.is_(None),
            (Coupon.expires_at.is_(None)) | (Coupon.expires_at > now),
        )
        .order_by(Coupon.expires_at.is_(None), Coupon.expires_at, Coupon.id)
        .all()
    )


def find_coupon(db: Session, user: User | None, code: str) -> tuple[Coupon | None, str]:
    """依代碼找出這位會員的券，並檢查是否還能用。"""
    if not user:
        return None, "請先登入才能使用折價券"
    if not code:
        return None, ""

    coupon = (
        db.query(Coupon)
        .filter(Coupon.code == code.strip().upper(), Coupon.user_id == user.id)
        .first()
    )
    if not coupon:
        return None, "找不到這張折價券，請確認代碼是否正確"
    if coupon.used_at is not None:
        return None, "這張折價券已經使用過了"
    if coupon.expires_at and coupon.expires_at < datetime.now():
        return None, "這張折價券已經過期"
    return coupon, ""


def calc_discount(
    coupon: Coupon | None,
    goods_after_member: float,
    shipping_fee: float,
) -> tuple[float, float, str]:
    """算出折價券的折抵金額。

    回傳 (商品折抵, 折抵後的運費, 錯誤訊息)。
    折價券的門檻以「會員折扣後的商品金額」判斷，不含運費。
    """
    if not coupon:
        return 0.0, shipping_fee, ""

    if goods_after_member < float(coupon.min_order_amount or 0):
        return 0.0, shipping_fee, (
            f"這張券需消費滿 NT${float(coupon.min_order_amount):.0f} 才能使用"
        )

    if coupon.kind == CouponKind.free_shipping:
        return 0.0, 0.0, ""

    if coupon.kind == CouponKind.percent:
        discount = goods_after_member * float(coupon.value) / 100
        if coupon.max_discount is not None and float(coupon.max_discount) > 0:
            discount = min(discount, float(coupon.max_discount))
    else:  # fixed
        discount = float(coupon.value)

    # 折抵不能超過商品金額，避免出現負數訂單
    discount = min(discount, goods_after_member)
    return round(discount, 2), shipping_fee, ""


def redeem(db: Session, coupon: Coupon | None, order_no: str) -> None:
    """把券標記為已使用。"""
    if not coupon:
        return
    coupon.used_at = datetime.now()
    coupon.used_order_no = order_no
    db.flush()


def coupon_label(coupon: Coupon) -> str:
    """給前端顯示的優惠說明。"""
    if coupon.kind == CouponKind.free_shipping:
        text = "免運費"
    elif coupon.kind == CouponKind.percent:
        text = f"{float(coupon.value):g}% 折扣"
        if coupon.max_discount:
            text += f"（最多折 NT${float(coupon.max_discount):.0f}）"
    else:
        text = f"折 NT${float(coupon.value):.0f}"
    if coupon.min_order_amount and float(coupon.min_order_amount) > 0:
        text += f"．滿 NT${float(coupon.min_order_amount):.0f} 可用"
    return text
