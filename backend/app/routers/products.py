from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload

from ..database import get_db
from ..deps import require_staff
from ..models import Category, Product, ProductImage
from ..schemas import (
    CategoryIn, CategoryOut, ProductIn, ProductImageOut, ProductOut,
)

router = APIRouter(prefix="/api", tags=["products"])


# ---------- 分類 ----------
@router.get("/categories", response_model=list[CategoryOut])
def list_categories(db: Session = Depends(get_db)):
    return db.query(Category).order_by(Category.sort_order, Category.id).all()


@router.post("/categories", response_model=CategoryOut, dependencies=[Depends(require_staff)])
def create_category(payload: CategoryIn, db: Session = Depends(get_db)):
    cat = Category(**payload.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}", dependencies=[Depends(require_staff)])
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    cat = db.get(Category, cat_id)
    if not cat:
        raise HTTPException(status_code=404, detail="找不到分類")
    db.delete(cat)
    db.commit()
    return {"ok": True}


# ---------- 商品 ----------
def _base_query(db: Session):
    return db.query(Product).options(
        joinedload(Product.category), joinedload(Product.images)
    )


@router.get("/products", response_model=list[ProductOut])
def list_products(
    db: Session = Depends(get_db),
    category: str | None = Query(default=None, description="分類 slug"),
    group_buy: bool | None = Query(default=None, description="只取團購商品"),
    featured: bool | None = Query(default=None, description="只取首頁精選"),
    keyword: str | None = None,
    include_inactive: bool = False,
):
    q = _base_query(db)
    if not include_inactive:
        q = q.filter(Product.is_active.is_(True))
    if category:
        q = q.join(Category).filter(Category.slug == category)
    if group_buy is not None:
        q = q.filter(Product.is_group_buy.is_(group_buy))
    if featured is not None:
        q = q.filter(Product.is_featured.is_(featured))
    if keyword:
        q = q.filter(Product.name.like(f"%{keyword}%"))
    return q.order_by(Product.sort_order, Product.id.desc()).all()


@router.get("/products/{product_id}", response_model=ProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = _base_query(db).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="找不到商品")
    return product


@router.post("/products", response_model=ProductOut, dependencies=[Depends(require_staff)])
def create_product(payload: ProductIn, db: Session = Depends(get_db)):
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.put("/products/{product_id}", response_model=ProductOut,
            dependencies=[Depends(require_staff)])
def update_product(product_id: int, payload: ProductIn, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="找不到商品")
    for field, value in payload.model_dump().items():
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", dependencies=[Depends(require_staff)])
def delete_product(product_id: int, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="找不到商品")
    db.delete(product)
    db.commit()
    return {"ok": True}


# ---------- 商品多圖 ----------
@router.post("/products/{product_id}/images", response_model=ProductImageOut,
             dependencies=[Depends(require_staff)])
def add_product_image(
    product_id: int,
    image_url: str,
    caption: str | None = None,
    sort_order: int = 0,
    db: Session = Depends(get_db),
):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="找不到商品")
    img = ProductImage(
        product_id=product_id, image_url=image_url,
        caption=caption, sort_order=sort_order,
    )
    db.add(img)
    db.commit()
    db.refresh(img)
    return img


@router.delete("/product-images/{image_id}", dependencies=[Depends(require_staff)])
def delete_product_image(image_id: int, db: Session = Depends(get_db)):
    img = db.get(ProductImage, image_id)
    if not img:
        raise HTTPException(status_code=404, detail="找不到圖片")
    db.delete(img)
    db.commit()
    return {"ok": True}
