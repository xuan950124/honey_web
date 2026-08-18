"""新聞報導、品牌故事、站台設定（聯絡方式）、政策條款。"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import policies
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
    # 首頁主視覺文案。跟 shop_slogan 分開是刻意的 ——
    # 頁首橫條那句要短，首頁大標下面那段需要完整說完一件事，兩者混用哪邊都不好看。
    "hero_title": "",
    "hero_highlight": "",
    "hero_desc": "",
    # 各頁面的固定圖片（後台可直接上傳，不用改程式碼）
    "hero_image_url": "",
    "group_buy_image_url": "",
    "line_qr_url": "",
    "favicon_url": "",
    "story_cover_url": "",
    # 農業部農糧署「溯源農糧產品追溯系統」資訊
    "producer_name": "",
    "traceability_code": "",
    # 業者資訊（賣包裝食品的法定揭露事項，顯示在頁尾與商品頁）
    "business_name": "",          # 商號 / 公司名稱
    "business_tax_id": "",        # 統一編號
    "food_registration_no": "",   # 食品業者登錄字號（非登不可）
    "business_owner": "",         # 負責人
    "business_address": "",       # 廠商地址（與蜂場地址可能不同）
    "business_phone": "",         # 廠商電話
    # 商品的共用食品標示。個別商品可以覆寫，沒填就用這裡的值
    "food_default_ingredients": "100% 蜂蜜",
    "food_default_storage": "請置於陰涼乾燥處，避免陽光直射；開封後請鎖緊瓶蓋。",
    "food_default_allergens": "",
    "food_infant_warning": "一歲以下嬰兒不宜食用蜂蜜（可能含肉毒桿菌孢子）。",
    # 運費設定
    "shipping_fee_cvs": "70",
    "shipping_fee_cvs_hilife": "60",
    "shipping_fee_home": "150",
    "shipping_fee_home_cold": "250",
    "shipping_fee_home_post": "90",
    "free_shipping_threshold": "0",
    "cod_fee": "0",
    "unpaid_expire_days": "3",
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


# ---------- 政策條款 ----------

@router.get("/policies")
def get_policies(db: Session = Depends(get_db)) -> dict[str, str]:
    """隱私權、服務條款、退換貨的內文。

    工作人員沒改過就給預設草稿。分成獨立的端點是因為這幾份文字很長，
    塞進 /settings 會讓每一頁都多載好幾 KB —— 而政策頁很少被打開。
    """
    settings_map = {r.key: (r.value or "") for r in db.query(SiteSetting).all()}
    out: dict[str, str] = {}
    for key, default in policies.DEFAULTS.items():
        out[key] = policies.render(settings_map.get(key) or default, settings_map)
    return out


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
