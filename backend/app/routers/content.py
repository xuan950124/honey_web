"""新聞報導、品牌故事、站台設定（聯絡方式）。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_staff
from ..models import News, SiteSetting, Story
from ..schemas import NewsIn, NewsOut, SettingsIn, StoryIn, StoryOut

router = APIRouter(prefix="/api", tags=["content"])


# ---------- 新聞報導 ----------
@router.get("/news", response_model=list[NewsOut])
def list_news(
    db: Session = Depends(get_db),
    category: str | None = None,
    include_inactive: bool = False,
    limit: int | None = None,
):
    q = db.query(News)
    if not include_inactive:
        q = q.filter(News.is_active.is_(True))
    if category:
        q = q.filter(News.category == category)
    q = q.order_by(News.published_at.desc(), News.id.desc())
    if limit:
        q = q.limit(limit)
    return q.all()


@router.get("/news/{news_id}", response_model=NewsOut)
def get_news(news_id: int, db: Session = Depends(get_db)):
    item = db.get(News, news_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到這則消息")
    return item


@router.post("/news", response_model=NewsOut, dependencies=[Depends(require_staff)])
def create_news(payload: NewsIn, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_none=True)
    item = News(**data)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/news/{news_id}", response_model=NewsOut, dependencies=[Depends(require_staff)])
def update_news(news_id: int, payload: NewsIn, db: Session = Depends(get_db)):
    item = db.get(News, news_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到這則消息")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(item, field, value)
    item.is_active = payload.is_active
    db.commit()
    db.refresh(item)
    return item


@router.delete("/news/{news_id}", dependencies=[Depends(require_staff)])
def delete_news(news_id: int, db: Session = Depends(get_db)):
    item = db.get(News, news_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到這則消息")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ---------- 品牌故事 ----------
@router.get("/stories", response_model=list[StoryOut])
def list_stories(db: Session = Depends(get_db), include_inactive: bool = False):
    q = db.query(Story)
    if not include_inactive:
        q = q.filter(Story.is_active.is_(True))
    return q.order_by(Story.sort_order, Story.id).all()


@router.get("/stories/{story_id}", response_model=StoryOut)
def get_story(story_id: int, db: Session = Depends(get_db)):
    item = db.get(Story, story_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到故事")
    return item


@router.post("/stories", response_model=StoryOut, dependencies=[Depends(require_staff)])
def create_story(payload: StoryIn, db: Session = Depends(get_db)):
    item = Story(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/stories/{story_id}", response_model=StoryOut,
            dependencies=[Depends(require_staff)])
def update_story(story_id: int, payload: StoryIn, db: Session = Depends(get_db)):
    item = db.get(Story, story_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到故事")
    for field, value in payload.model_dump().items():
        setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/stories/{story_id}", dependencies=[Depends(require_staff)])
def delete_story(story_id: int, db: Session = Depends(get_db)):
    item = db.get(Story, story_id)
    if not item:
        raise HTTPException(status_code=404, detail="找不到故事")
    db.delete(item)
    db.commit()
    return {"ok": True}


# ---------- 站台設定（聯絡方式）----------
DEFAULT_SETTINGS = {
    "shop_name": "",
    "shop_slogan": "",
    "contact_phone": "",
    "contact_phone_2": "",
    "contact_email": "",
    "contact_address": "",
    "line_id": "",
    "line_url": "",
    "business_hours": "",
    "facebook_url": "",
    "instagram_url": "",
    "map_embed_url": "",
    # 各頁面的固定圖片（後台可直接上傳，不用改程式碼）
    "hero_image_url": "",
    "group_buy_image_url": "",
    "line_qr_url": "",
    "story_cover_url": "",
    # 農業部農糧署「溯源農糧產品追溯系統」資訊
    "producer_name": "",
    "traceability_code": "",
    # 運費設定
    "shipping_fee_cvs": "70",
    "shipping_fee_home": "160",
    "shipping_fee_home_cold": "250",
    "free_shipping_threshold": "0",
    "cod_fee": "0",
    # 寄件人資訊（建立物流單時使用，宅配必填）
    "sender_name": "",
    "sender_phone": "",
    "sender_cellphone": "",
    "sender_zipcode": "",
    "sender_address": "",
}


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)) -> dict[str, str]:
    rows = db.query(SiteSetting).all()
    result = dict(DEFAULT_SETTINGS)
    for row in rows:
        result[row.key] = row.value or ""
    return result


@router.put("/settings", dependencies=[Depends(require_staff)])
def update_settings(payload: SettingsIn, db: Session = Depends(get_db)) -> dict[str, str]:
    for key, value in payload.values.items():
        row = db.get(SiteSetting, key)
        if row:
            row.value = value
        else:
            db.add(SiteSetting(key=key, value=value))
    db.commit()
    return get_settings(db)
