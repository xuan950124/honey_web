"""會員等級、折價券的查詢與後台管理。"""
from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import membership as ms
from ..database import get_db
from ..deps import get_current_user, require_staff
from ..models import Coupon, CouponRule, MemberTier, Order, User, UserRole
from ..schemas import (
    CouponOut, CouponRuleIn, CouponRuleOut, MemberSummaryOut, MemberTierIn,
    MemberTierOut, MembershipOut,
)

router = APIRouter(prefix="/api", tags=["membership"])


def _decorate_coupon(coupon: Coupon) -> Coupon:
    coupon.label = ms.coupon_label(coupon)
    coupon.is_usable = coupon.used_at is None and (
        coupon.expires_at is None or coupon.expires_at > datetime.now()
    )
    return coupon


# ---------------------------------------------------------------- 前台

@router.get("/membership/tiers", response_model=list[MemberTierOut])
def public_tiers(db: Session = Depends(get_db)):
    """會員等級一覽，未登入也看得到（可以當作加入會員的誘因）。"""
    return ms.list_tiers(db)


@router.get("/membership/me", response_model=MembershipOut)
def my_membership(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tier = ms.current_tier(db, user)
    nxt = ms.next_tier(db, user)
    spent = float(user.total_spent or 0)

    usable = [_decorate_coupon(c) for c in ms.usable_coupons(db, user)]
    used = [
        _decorate_coupon(c)
        for c in db.query(Coupon)
        .filter(Coupon.user_id == user.id, Coupon.used_at.isnot(None))
        .order_by(Coupon.used_at.desc())
        .limit(20)
        .all()
    ]

    return MembershipOut(
        total_spent=spent,
        tier=MemberTierOut.model_validate(tier) if tier else None,
        next_tier=MemberTierOut.model_validate(nxt) if nxt else None,
        amount_to_next_tier=max(0.0, float(nxt.min_spent) - spent) if nxt else 0.0,
        tiers=[MemberTierOut.model_validate(t) for t in ms.list_tiers(db)],
        coupons=[CouponOut.model_validate(c) for c in usable],
        used_coupons=[CouponOut.model_validate(c) for c in used],
    )


# ---------------------------------------------------------------- 後台：會員等級

@router.get("/admin/tiers", response_model=list[MemberTierOut],
            dependencies=[Depends(require_staff)])
def admin_tiers(db: Session = Depends(get_db)):
    return db.query(MemberTier).order_by(MemberTier.min_spent, MemberTier.id).all()


@router.post("/admin/tiers", response_model=MemberTierOut,
             dependencies=[Depends(require_staff)])
def create_tier(payload: MemberTierIn, db: Session = Depends(get_db)):
    tier = MemberTier(**payload.model_dump())
    db.add(tier)
    db.commit()
    db.refresh(tier)
    return tier


@router.put("/admin/tiers/{tier_id}", response_model=MemberTierOut,
            dependencies=[Depends(require_staff)])
def update_tier(tier_id: int, payload: MemberTierIn, db: Session = Depends(get_db)):
    tier = db.get(MemberTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="找不到會員等級")
    for field, value in payload.model_dump().items():
        setattr(tier, field, value)
    db.commit()
    db.refresh(tier)
    return tier


@router.delete("/admin/tiers/{tier_id}", dependencies=[Depends(require_staff)])
def delete_tier(tier_id: int, db: Session = Depends(get_db)):
    tier = db.get(MemberTier, tier_id)
    if not tier:
        raise HTTPException(status_code=404, detail="找不到會員等級")
    db.delete(tier)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 後台：發券規則

@router.get("/admin/coupon-rules", response_model=list[CouponRuleOut],
            dependencies=[Depends(require_staff)])
def admin_rules(db: Session = Depends(get_db)):
    return db.query(CouponRule).order_by(CouponRule.sort_order, CouponRule.id).all()


@router.post("/admin/coupon-rules", response_model=CouponRuleOut,
             dependencies=[Depends(require_staff)])
def create_rule(payload: CouponRuleIn, db: Session = Depends(get_db)):
    rule = CouponRule(**payload.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/admin/coupon-rules/{rule_id}", response_model=CouponRuleOut,
            dependencies=[Depends(require_staff)])
def update_rule(rule_id: int, payload: CouponRuleIn, db: Session = Depends(get_db)):
    rule = db.get(CouponRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="找不到發券規則")
    for field, value in payload.model_dump().items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/admin/coupon-rules/{rule_id}", dependencies=[Depends(require_staff)])
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    rule = db.get(CouponRule, rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="找不到發券規則")
    db.delete(rule)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- 後台：會員與券

@router.get("/admin/members", response_model=list[MemberSummaryOut],
            dependencies=[Depends(require_staff)])
def admin_members(db: Session = Depends(get_db), keyword: str | None = None):
    q = db.query(User).filter(User.role == UserRole.member)
    if keyword:
        like = f"%{keyword}%"
        q = q.filter((User.name.like(like)) | (User.email.like(like)) | (User.phone.like(like)))
    users = q.order_by(User.total_spent.desc(), User.id.desc()).all()

    order_counts = dict(
        db.query(Order.user_id, func.count(Order.id))
        .filter(Order.user_id.isnot(None))
        .group_by(Order.user_id)
        .all()
    )
    coupon_counts = dict(
        db.query(Coupon.user_id, func.count(Coupon.id))
        .filter(Coupon.used_at.is_(None))
        .group_by(Coupon.user_id)
        .all()
    )

    result = []
    for u in users:
        tier = ms.current_tier(db, u)
        summary = MemberSummaryOut.model_validate(u)
        summary.tier_name = tier.name if tier else None
        summary.order_count = order_counts.get(u.id, 0)
        summary.coupon_count = coupon_counts.get(u.id, 0)
        result.append(summary)
    return result


@router.get("/admin/coupons", response_model=list[CouponOut],
            dependencies=[Depends(require_staff)])
def admin_coupons(db: Session = Depends(get_db), only_unused: bool = False):
    q = db.query(Coupon)
    if only_unused:
        q = q.filter(Coupon.used_at.is_(None))
    coupons = q.order_by(Coupon.id.desc()).limit(300).all()
    return [_decorate_coupon(c) for c in coupons]
