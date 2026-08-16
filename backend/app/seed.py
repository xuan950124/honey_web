"""初始化資料庫：建立管理員帳號與示範資料。

用法（在 backend 資料夾下）：
    python -m app.seed

所有照片欄位一律留空，前端會顯示空白佔位框，之後再由後台上傳補上。
"""
from datetime import datetime, timedelta

from .config import settings
from .database import Base, SessionLocal, engine, ensure_database, sync_schema
from .models import Category, News, Product, SiteSetting, Story, User, UserRole
from .security import hash_password

CATEGORIES = [
    {"name": "純蜂蜜", "slug": "pure-honey", "sort_order": 1},
    {"name": "禮盒組", "slug": "gift-box", "sort_order": 2},
    {"name": "蜂蜜加工品", "slug": "processed", "sort_order": 3},
    {"name": "團購專區", "slug": "group-buy", "sort_order": 4},
]

PRODUCTS = [
    {
        "name": "台灣龍眼蜜", "subtitle": "濃郁焦糖香氣，經典國產花蜜",
        "spec": "700g / 玻璃瓶", "origin": "基隆 七堵",
        "price": 680, "original_price": 780, "stock": 50,
        "is_featured": True, "category": "pure-honey", "sort_order": 1,
        "description": "蜜色深琥珀，帶有明顯焦糖與煙燻尾韻。\n未經加熱稀釋，開瓶後常溫保存即可，結晶屬天然現象。",
    },
    {
        "name": "百花蜜", "subtitle": "清爽花香，入口回甘",
        "spec": "700g / 玻璃瓶", "origin": "基隆 七堵",
        "price": 580, "stock": 60,
        "is_featured": True, "category": "pure-honey", "sort_order": 2,
        "description": "蜜蜂在基隆山區採集多種野花所釀，風味層次豐富，甜度溫和不膩口。\n適合沖泡冷飲、拌優格或直接品嘗。",
    },
    {
        "name": "荔枝蜜", "subtitle": "淡雅果香，色澤金黃透亮",
        "spec": "500g / 玻璃瓶", "origin": "基隆 七堵",
        "price": 620, "stock": 40,
        "is_featured": True, "category": "pure-honey", "sort_order": 3,
        "description": "荔枝花期短，產量稀少。蜜體清透，帶有淡淡荔枝果香，是入門者最容易接受的風味。",
    },
    {
        "name": "蜂蜜禮盒（雙入組）", "subtitle": "龍眼蜜 + 百花蜜，附提袋",
        "spec": "700g x 2", "origin": "基隆 七堵",
        "price": 1280, "original_price": 1360, "stock": 25,
        "is_featured": True, "category": "gift-box", "sort_order": 4,
        "description": "年節送禮首選，內含台灣龍眼蜜與百花蜜各一瓶，另附贈精緻提袋與手寫卡片。",
    },
    {
        "name": "蜂王乳（新鮮冷凍）", "subtitle": "當日採收，全程冷鏈配送",
        "spec": "100g / 瓶", "origin": "基隆 七堵",
        "price": 950, "stock": 20,
        "category": "processed", "sort_order": 5,
        "description": "每日清晨採收後立即冷凍鎖鮮，需冷凍保存。建議搭配蜂蜜調和後食用。",
    },
    {
        "name": "台灣蜂花粉", "subtitle": "天然顆粒，未經調味",
        "spec": "200g / 罐", "origin": "基隆 七堵",
        "price": 480, "stock": 35,
        "category": "processed", "sort_order": 6,
        "description": "蜜蜂自花朵採集的花粉團，含天然植物營養素。初次食用建議少量嘗試。",
    },
    # ---- 團購商品 ----
    {
        "name": "【團購】龍眼蜜 6 入組", "subtitle": "6 瓶成團，每瓶現省 130 元",
        "spec": "700g x 6", "origin": "基隆 七堵",
        "price": 3300, "original_price": 4080, "stock": 30,
        "is_group_buy": True, "group_buy_min_qty": 1,
        "group_buy_note": "6 瓶為一組，下單即成團，約 3-5 個工作天出貨。",
        "category": "group-buy", "sort_order": 7,
        "description": "公司行號、社區揪團最划算的選擇，可分開包裝、分別附上贈品卡。",
    },
    {
        "name": "【團購】綜合蜂蜜 12 入組", "subtitle": "龍眼蜜 6 + 百花蜜 6",
        "spec": "700g x 12", "origin": "基隆 七堵",
        "price": 6000, "original_price": 7560, "stock": 15,
        "is_group_buy": True, "group_buy_min_qty": 1,
        "group_buy_note": "滿 12 瓶免運，可指定多個收件地址（請於備註欄說明）。",
        "category": "group-buy", "sort_order": 8,
        "description": "適合公司福委、幼兒園、社團大量訂購。需要客製標籤或開立三聯式發票請先聯絡我們。",
    },
    {
        "name": "【團購】蜂蜜隨手包 30 入", "subtitle": "20g 隨身包，辦公室、外出方便",
        "spec": "20g x 30", "origin": "基隆 七堵",
        "price": 900, "original_price": 1050, "stock": 50,
        "is_group_buy": True, "group_buy_min_qty": 1,
        "group_buy_note": "單筆滿 3 組免運費。",
        "category": "group-buy", "sort_order": 9,
        "description": "獨立包裝，撕開即可使用，適合泡茶、沖水、送客戶做小禮。",
    },
]

NEWS = [
    {
        "title": "本地蜂農採用友善農法，蜂蜜品質獲檢驗肯定",
        "summary": "報導本場採用無農藥友善管理方式，並定期送驗農藥殘留與抗生素項目。",
        "source": "（媒體名稱待補）", "category": "media", "days_ago": 12,
        "content": "此處放置報導全文或摘要內容，可於後台編輯。\n\n工作人員登入後台後，可在「新聞管理」新增／編輯每一則報導，並附上原文連結與封面照片。",
    },
    {
        "title": "龍眼花期報告：今年氣候穩定，蜜量較去年成長",
        "summary": "四月中旬進入盛花期，蜜蜂採集狀況良好，預估產量較去年同期增加。",
        "source": "（媒體名稱待補）", "category": "media", "days_ago": 30,
        "content": "此處放置報導全文或摘要內容，可於後台編輯。",
    },
    {
        "title": "中秋禮盒預購開跑，早鳥享優惠",
        "summary": "即日起至月底止，禮盒組預購享早鳥價，數量有限售完為止。",
        "category": "news", "days_ago": 5,
        "content": "此處放置最新消息內容，可於後台編輯。",
    },
    {
        "title": "端午連假出貨公告",
        "summary": "連假期間物流暫停收件，訂單將於收假後依序出貨，敬請見諒。",
        "category": "news", "days_ago": 45,
        "content": "此處放置最新消息內容，可於後台編輯。",
    },
]

STORIES = [
    {
        "title": "從第一箱蜂開始",
        "subtitle": "我們沒有祖傳的蜂場",
        "sort_order": 1,
        "content": "很多蜂農會說自己是第幾代傳人。我們不是——我們是從第一箱蜂開始學起的。\n\n沒有長輩可以問，該什麼時候加繼箱、蜂群為什麼躁動、蜜什麼時候才算熟，全都是自己一次一次試出來的。前幾年繳了不少學費，也失敗過幾次。\n\n但也因為是自己從頭學的，每一個決定我們都知道為什麼要這樣做。（這段文字可於後台「故事管理」自行修改）",
    },
    {
        "title": "基隆的雨，基隆的花",
        "subtitle": "在全台灣最多雨的地方養蜂",
        "sort_order": 2,
        "content": "基隆一年有超過兩百天在下雨。對養蜂來說這不是好條件——雨天蜜蜂出不了門，花期也常常被雨打斷。\n\n但山裡的濕氣養出了別的地方少見的蜜源植物，採出來的蜜也有不一樣的風味。我們的蜂場就在七堵的山邊，看天吃飯，產量不多，但都是這片山給的。（這段文字可於後台「故事管理」自行修改）",
    },
    {
        "title": "查得到的人，查得到的蜜",
        "subtitle": "農業部溯源追溯編號 1801000072",
        "sort_order": 3,
        "content": "我們登錄了農業部農糧署的「溯源農糧產品追溯系統」，追溯編號是 1801000072。\n\n上網輸入這組號碼，就能查到生產者是誰、在哪裡生產。蜂蜜這種東西，外觀很難分辨真假，所以我們願意把自己的名字掛上去。\n\n採收上，我們等蜜在巢裡熟成才取，裝瓶前不加水、不加糖、不調味。低溫時結晶是天然現象，隔水溫熱就會恢復。（這段文字可於後台「故事管理」自行修改）",
    },
]

SETTINGS = {
    "shop_name": "皇龍蜂蜜",
    "shop_slogan": "基隆七堵山區的自家蜂場，第一代養蜂人的蜜",
    "producer_name": "黃皇龍",
    "traceability_code": "1801000072",
    "contact_phone": "",
    "contact_phone_2": "",
    "contact_email": "",
    "contact_address": "",
    "line_id": "",
    "line_url": "",
    "business_hours": "週一至週五 09:00 - 18:00（例假日公休）",
    "facebook_url": "",
    "instagram_url": "",
    "map_embed_url": "",
}


def run() -> None:
    ensure_database()
    Base.metadata.create_all(bind=engine)
    sync_schema()
    db = SessionLocal()
    try:
        # 管理員（工作人員）帳號
        # 內建帳號直接標記為已驗證，不需要真的去收驗證信
        admin = db.query(User).filter(User.email == settings.ADMIN_EMAIL).first()
        if not admin:
            db.add(User(
                email=settings.ADMIN_EMAIL,
                hashed_password=hash_password(settings.ADMIN_PASSWORD),
                name=settings.ADMIN_NAME,
                role=UserRole.staff,
                email_verified=True,
                email_verified_at=datetime.now(),
            ))
            print(f"[建立] 工作人員帳號 {settings.ADMIN_EMAIL} / {settings.ADMIN_PASSWORD}")
        else:
            print(f"[略過] 工作人員帳號 {settings.ADMIN_EMAIL} 已存在")

        # 示範會員
        if not db.query(User).filter(User.email == "member@honeyshop.com").first():
            db.add(User(
                email="member@honeyshop.com",
                hashed_password=hash_password("member1234"),
                name="示範會員",
                role=UserRole.member,
                email_verified=True,
                email_verified_at=datetime.now(),
            ))
            print("[建立] 示範會員 member@honeyshop.com / member1234")

        db.commit()

        # 既有的內建帳號若還沒驗證，一併補上（升級舊資料庫時會用到）
        builtin = db.query(User).filter(
            User.email.in_([settings.ADMIN_EMAIL, "member@honeyshop.com"]),
            User.email_verified.is_(False),
        ).all()
        for user in builtin:
            user.email_verified = True
            user.email_verified_at = datetime.now()
            print(f"[更新] {user.email} 標記為已驗證信箱")

        # 所有工作人員帳號都不需要驗證信箱
        staff_unverified = db.query(User).filter(
            User.role == UserRole.staff, User.email_verified.is_(False)
        ).all()
        for user in staff_unverified:
            user.email_verified = True
            user.email_verified_at = datetime.now()
            print(f"[更新] 工作人員 {user.email} 標記為已驗證信箱")

        db.commit()

        # 分類
        slug_map: dict[str, Category] = {}
        for data in CATEGORIES:
            cat = db.query(Category).filter(Category.slug == data["slug"]).first()
            if not cat:
                cat = Category(**data)
                db.add(cat)
                db.flush()
            slug_map[data["slug"]] = cat
        db.commit()

        # 商品（image_url 全部留空，前端顯示空白佔位）
        if db.query(Product).count() == 0:
            for data in PRODUCTS:
                payload = dict(data)
                cat_slug = payload.pop("category", None)
                payload["category_id"] = slug_map[cat_slug].id if cat_slug else None
                payload["image_url"] = None
                db.add(Product(**payload))
            print(f"[建立] {len(PRODUCTS)} 筆示範商品")
        db.commit()

        # 新聞
        if db.query(News).count() == 0:
            for data in NEWS:
                payload = dict(data)
                days = payload.pop("days_ago", 0)
                payload["published_at"] = datetime.now() - timedelta(days=days)
                payload["cover_url"] = None
                db.add(News(**payload))
            print(f"[建立] {len(NEWS)} 筆示範新聞")
        db.commit()

        # 故事
        if db.query(Story).count() == 0:
            for data in STORIES:
                db.add(Story(**data, cover_url=None))
            print(f"[建立] {len(STORIES)} 筆品牌故事")
        db.commit()

        # 站台設定
        for key, value in SETTINGS.items():
            if not db.get(SiteSetting, key):
                db.add(SiteSetting(key=key, value=value))
        db.commit()

        print("\n初始化完成。請啟動： uvicorn app.main:app --reload --port 8000")
    finally:
        db.close()


if __name__ == "__main__":
    run()
