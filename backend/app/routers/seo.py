"""sitemap.xml 與 robots.txt。

sitemap 由後端產生，因為只有後端知道現在有哪些商品與報導。
裡面的網址指向**前端網域**（FRONTEND_BASE_URL），不是 API 網域。

> 注意：sitemap 的網址（api.你的網域）與裡面列的網址（www 那個網域）不同，
> 這在 Google 叫做「跨網域提交」。要生效必須在 Search Console
> 把兩個網域都驗證過 —— 兩個都是你的，加一筆 DNS TXT 就好。
> 詳細步驟見 docs/上線前必辦清單.md。
"""
from __future__ import annotations

import re
from datetime import datetime
from xml.sax.saxutils import escape

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import News, Product, Story

router = APIRouter(tags=["seo"])

# 固定頁面與它們的相對重要性。
# priority 是給搜尋引擎的相對提示，同一個網站內比較才有意義。
STATIC_PAGES: list[tuple[str, str, str]] = [
    ("/", "daily", "1.0"),
    ("/products", "daily", "0.9"),
    ("/group-buy", "weekly", "0.8"),
    ("/story", "monthly", "0.7"),
    ("/news", "weekly", "0.7"),
    ("/contact", "monthly", "0.6"),
    ("/privacy", "yearly", "0.2"),
    ("/terms", "yearly", "0.2"),
    ("/refund", "yearly", "0.3"),
]


def _entry(base: str, path: str, changefreq: str, priority: str,
           lastmod: datetime | None = None) -> str:
    parts = [f"  <url>\n    <loc>{escape(base + path)}</loc>"]
    if lastmod:
        parts.append(f"    <lastmod>{lastmod.strftime('%Y-%m-%d')}</lastmod>")
    parts.append(f"    <changefreq>{changefreq}</changefreq>")
    parts.append(f"    <priority>{priority}</priority>")
    parts.append("  </url>")
    return "\n".join(parts)


@router.get("/sitemap.xml", response_class=Response)
def sitemap(db: Session = Depends(get_db)) -> Response:
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    rows = [_entry(base, path, freq, pri) for path, freq, pri in STATIC_PAGES]

    # 商品頁。只列上架中的 —— 把下架商品交給 Google 收錄，
    # 使用者點進去看到 404，對排名是扣分的。
    try:
        products = (
            db.query(Product)
            .filter(Product.is_active.is_(True))
            .order_by(Product.id).all()
        )
        for p in products:
            rows.append(_entry(base, f"/products/{p.id}", "weekly", "0.8", p.updated_at))
    except Exception:  # noqa: BLE001 - 資料庫有問題時仍要回得出靜態頁的 sitemap
        pass

    try:
        news = (
            db.query(News).filter(News.is_active.is_(True))
            .order_by(News.id).all()
        )
        for n in news:
            rows.append(_entry(base, f"/news/{n.id}", "monthly", "0.6", n.published_at))
    except Exception:  # noqa: BLE001
        pass

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(rows)
        + "\n</urlset>\n"
    )
    return Response(content=xml, media_type="application/xml")


@router.get("/robots.txt", response_class=Response)
def robots() -> Response:
    """給爬蟲的規則。

    後台、購物車、訂單頁一律不收錄 —— 那些頁面對搜尋沒有意義，
    而且訂單頁的網址帶存取碼，被收錄等於外流。
    """
    base = settings.BACKEND_BASE_URL.rstrip("/")
    body = f"""User-agent: *
Allow: /
Disallow: /admin
Disallow: /cart
Disallow: /order
Disallow: /member
Disallow: /login
Disallow: /register
Disallow: /reset-password
Disallow: /verify-email

Sitemap: {base}/sitemap.xml
"""
    return Response(content=body, media_type="text/plain")


@router.get("/api/seo/structured-data")
def structured_data(db: Session = Depends(get_db)) -> dict:
    """首頁用的 LocalBusiness 結構化資料。

    你有實體蜂場地址，對「基隆蜂蜜」這種在地關鍵字很有幫助 ——
    Google 會把它拿去做地圖與知識面板的比對。
    """
    from ..models import SiteSetting

    cfg = {r.key: (r.value or "") for r in db.query(SiteSetting).all()}
    front = settings.FRONTEND_BASE_URL.rstrip("/")

    data: dict = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": cfg.get("shop_name") or "黃家基蜜",
        "url": front,
    }
    # 空欄位一律不放進去 —— 帶著空字串的結構化資料會被 Google 判定無效
    description = cfg.get("hero_desc") or cfg.get("shop_slogan")
    if description:
        data["description"] = description
    if cfg.get("contact_phone"):
        data["telephone"] = cfg["contact_phone"]
    if cfg.get("contact_email"):
        data["email"] = cfg["contact_email"]
    if cfg.get("contact_address"):
        data["address"] = {
            "@type": "PostalAddress",
            "addressCountry": "TW",
            "addressRegion": "基隆市",
            "streetAddress": cfg["contact_address"],
        }
    if cfg.get("hero_image_url"):
        image = cfg["hero_image_url"]
        data["image"] = image if image.startswith("http") else (
            settings.BACKEND_BASE_URL.rstrip("/") + image
        )
    socials = [cfg.get("facebook_url"), cfg.get("instagram_url")]
    if any(socials):
        data["sameAs"] = [s for s in socials if s]
    if cfg.get("business_hours"):
        data["openingHours"] = cfg["business_hours"]

    # @id 讓 Google 把不同頁面提到的「我們」認成同一個實體，
    # 而不是每一頁各自一個沒有關聯的商家
    data["@id"] = f"{front}/#business"

    # 在地關鍵字最有力的三個訊號：座標、地圖連結、服務範圍。
    #
    # 「基隆蜂蜜」「七堵蜂蜜」這種查詢 Google 是拿地理位置在比對的，
    # 只給一段地址字串它還要自己猜（而且會把 89-6 號猜成 89 號）。
    # 座標是明確的，沒有猜的空間。
    point = _coordinates(cfg.get("map_embed_url", ""))
    if point:
        data["geo"] = {
            "@type": "GeoCoordinates",
            "latitude": point[0],
            "longitude": point[1],
        }
    if cfg.get("map_link_url", "").startswith("http"):
        data["hasMap"] = cfg["map_link_url"]

    data["areaServed"] = {"@type": "Country", "name": "台灣"}
    data["currenciesAccepted"] = "TWD"
    data["paymentAccepted"] = "信用卡, ATM 轉帳, 超商代碼繳費, 貨到付款"

    # 價格區間：Google 的在地結果會顯示，也是一個「這是真的在營業」的訊號
    try:
        prices = [
            float(p.price) for p in
            db.query(Product).filter(Product.is_active.is_(True)).all()
            if p.price
        ]
        if prices:
            data["priceRange"] = f"NT${int(min(prices))}–{int(max(prices))}"
    except Exception:  # noqa: BLE001
        pass

    # 只列主題當作內容深度的訊號，不放實際內容（那應該由頁面本身提供）
    try:
        data["knowsAbout"] = ["蜂蜜", "野花蜜", "龍眼蜜", "百花蜜", "養蜂", "基隆七堵", "蜂蜜團購"]
        if db.query(Story).filter(Story.is_active.is_(True)).count():
            data.setdefault("hasMap", f"{front}/contact")
    except Exception:  # noqa: BLE001
        pass

    return data


# 座標可能存成「25.09, 121.66」，也可能藏在嵌入碼的 pb 參數裡（!2d經度!3d緯度）
_COORD_PLAIN = re.compile(r"^\s*(-?\d{1,3}\.\d+)\s*[,，]\s*(-?\d{1,3}\.\d+)\s*$")
_COORD_PB = re.compile(r"!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)")
_COORD_AT = re.compile(r"@(-?\d+\.\d+),\s*(-?\d+\.\d+)")


def _coordinates(raw: str) -> tuple[float, float] | None:
    """從後台填的地圖設定取出 (緯度, 經度)。取不出來就回 None。

    跟前端 `lib/maps.js` 的 `mapPoint()` 是同一套規則 ——
    兩邊都要認得同樣的格式，不然畫面上的點跟給 Google 的座標會不一樣。
    """
    text = (raw or "").strip()
    if not text:
        return None

    plain = _COORD_PLAIN.match(text)
    if plain:
        return (float(plain.group(1)), float(plain.group(2)))

    at = _COORD_AT.search(text)
    if at:
        return (float(at.group(1)), float(at.group(2)))

    # pb 參數是先經度再緯度，要反過來
    pb = _COORD_PB.search(text)
    if pb:
        return (float(pb.group(2)), float(pb.group(1)))

    return None


@router.get("/api/seo/faq")
def faq_structured_data(db: Session = Depends(get_db)) -> dict:
    """常見問題的結構化資料（FAQPage）。

    這是投資報酬率最高的一種 —— Google 會把問答直接展開在搜尋結果裡，
    佔的版面比一般結果大好幾倍，而且「蜂蜜會結晶是壞掉嗎」這種問題
    本來就有人在搜，等於免費的曝光。

    內容跟前台團購頁與商品頁講的是同一套，不能只為了 SEO 而寫 ——
    Google 會比對頁面上找不找得到這些字。
    """
    from ..models import SiteSetting

    cfg = {r.key: (r.value or "") for r in db.query(SiteSetting).all()}
    front = settings.FRONTEND_BASE_URL.rstrip("/")

    qa = [
        ("蜂蜜結晶是壞掉了嗎？",
         "不是。低溫時蜂蜜裡的葡萄糖會自然析出結晶，隔水溫熱（水溫不超過 60°C）"
         "就會恢復流動。會結晶反而是天然蜜的特徵之一，加了糖漿的蜜通常不會結晶。"),
        ("怎麼確認買到的是真蜂蜜？",
         f"我們登錄了農業部農糧署的溯源農糧產品追溯系統，追溯編號是"
         f"{cfg.get('traceability_code') or '1801000072'}，"
         "上網輸入就查得到生產者是誰、在哪裡生產。蜂蜜外觀很難分辨真假，"
         "所以我們把自己的名字掛上去。"),
        ("蜂蜜可以放多久？要冰嗎？",
         "常溫陰涼處保存即可，不用冷藏，避免陽光直射、開封後鎖緊瓶蓋。"
         "純蜂蜜的保存期限通常是兩年。"),
        ("一歲以下的寶寶可以吃蜂蜜嗎？",
         "不可以。蜂蜜可能含有肉毒桿菌孢子，一歲以下嬰兒的腸道菌相尚未健全，"
         "有感染風險。一歲以上就沒有這個問題。"),
        ("團購可以分開寄到不同地址嗎？",
         "網站下單的團購組合只能寄到一個地址，運費也只收一次，由主購收到後分發。"
         "需要分開包裝、分別寄送的話請先用 LINE 或電話聯絡，我們會依件數報價。"),
        ("你們開發票嗎？",
         "我們是自產自銷的養蜂場，依營業稅法免辦營業登記、免徵營業稅，"
         "因此沒有統一編號，開立「農民收據」而非統一發票。"
         "公司行號團購多半可憑此核銷，建議先與貴單位會計確認。"),
        ("多久會出貨？",
         "訂單確認後約 3～5 個工作天出貨，連假與年節期間會另行公告。"
         "超商取貨與宅配都可以選，出貨後會提供物流單號。"),
    ]

    return {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": f"{front}/#faq",
        "mainEntity": [
            {
                "@type": "Question",
                "name": q,
                "acceptedAnswer": {"@type": "Answer", "text": a},
            }
            for q, a in qa
        ],
    }
