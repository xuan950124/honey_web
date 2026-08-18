"""會員的購物車（跟著帳號走，換裝置也看得到）。

設計上的兩個決定：

1. **只存商品 ID 與數量，不存價格。**
   價格會變，存下來就會出現「加入時 680、結帳時 720」的爭議。
   每次讀取都用當下的價格重算，以最新的為準。

2. **登入時用「合併」而不是「覆蓋」。**
   兩邊都可能有東西：家裡的電腦加了兩罐、公司的瀏覽器加了一罐。
   取聯集、同商品取較多的那一邊 —— 不管選哪一邊覆蓋都會弄丟客人加的東西，
   而「東西不見了」比「多了一罐要自己刪掉」嚴重得多。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import CartItem, Product, User

router = APIRouter(prefix="/api/cart", tags=["cart"])

# 單一商品的數量上限。防止有人送出天文數字把資料弄髒
MAX_QTY = 999


class CartLineIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=MAX_QTY)


class CartIn(BaseModel):
    items: list[CartLineIn] = []


class CartLineOut(BaseModel):
    id: int                 # 商品 ID（前端的購物車用這個當 key）
    name: str
    price: float
    spec: str | None = None
    image_url: str | None = None
    stock: int | None = None
    quantity: int


def _load(db: Session, user: User) -> list[CartLineOut]:
    """讀出購物車，順便用當下的商品資料校正。

    下架或售完的品項直接從購物車移除 ——
    留著只會讓客人在結帳時才發現買不到，那時他已經填完一整頁資料了。
    """
    rows = (
        db.query(CartItem, Product)
        .join(Product, Product.id == CartItem.product_id)
        .filter(CartItem.user_id == user.id)
        .order_by(CartItem.id)
        .all()
    )

    out: list[CartLineOut] = []
    stale: list[CartItem] = []
    for item, product in rows:
        if not product.is_active or (product.stock is not None and product.stock <= 0):
            stale.append(item)
            continue
        quantity = item.quantity
        if product.stock is not None and quantity > product.stock:
            quantity = product.stock
            item.quantity = quantity
        out.append(CartLineOut(
            id=product.id,
            name=product.name,
            price=float(product.price),
            spec=product.spec,
            image_url=product.image_url,
            stock=product.stock,
            quantity=quantity,
        ))

    for item in stale:
        db.delete(item)
    if stale or out:
        db.commit()
    return out


@router.get("", response_model=list[CartLineOut])
def get_cart(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _load(db, user)


@router.put("", response_model=list[CartLineOut])
def replace_cart(
    payload: CartIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """整台購物車覆蓋掉。前端每次變動就送一次完整內容。

    用「整批覆蓋」而不是逐項增刪，是因為購物車的操作很細碎
    （加一個、減一個、刪一個），逐項同步時只要漏掉一次請求，
    兩邊就永遠對不起來。整批覆蓋沒有這個問題。
    """
    wanted: dict[int, int] = {}
    for line in payload.items:
        wanted[line.product_id] = min(MAX_QTY, wanted.get(line.product_id, 0) + line.quantity)

    if wanted:
        valid = {
            p.id for p in db.query(Product.id).filter(Product.id.in_(list(wanted))).all()
        }
        wanted = {pid: q for pid, q in wanted.items() if pid in valid}

    db.query(CartItem).filter(CartItem.user_id == user.id).delete()
    for product_id, quantity in wanted.items():
        db.add(CartItem(user_id=user.id, product_id=product_id, quantity=quantity))
    db.commit()
    return _load(db, user)


@router.post("/merge", response_model=list[CartLineOut])
def merge_cart(
    payload: CartIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """登入時呼叫：把本機的購物車併進伺服器的那一份。

    同一個商品兩邊都有時取數量較多的那一邊。
    不是相加 —— 相加的話，在同一台電腦上重新整理幾次就會愈加愈多。
    """
    local: dict[int, int] = {}
    for line in payload.items:
        local[line.product_id] = min(MAX_QTY, max(local.get(line.product_id, 0), line.quantity))

    existing = {
        row.product_id: row
        for row in db.query(CartItem).filter(CartItem.user_id == user.id).all()
    }

    valid = {
        p.id for p in db.query(Product.id)
        .filter(Product.id.in_(list(local)), Product.is_active.is_(True)).all()
    } if local else set()

    for product_id, quantity in local.items():
        if product_id not in valid:
            continue
        row = existing.get(product_id)
        if row:
            row.quantity = max(row.quantity, quantity)
        else:
            db.add(CartItem(user_id=user.id, product_id=product_id, quantity=quantity))
    db.commit()
    return _load(db, user)


@router.delete("", status_code=204)
def clear_cart(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """清空。訂單成立後會呼叫。"""
    db.query(CartItem).filter(CartItem.user_id == user.id).delete()
    db.commit()
    return None
