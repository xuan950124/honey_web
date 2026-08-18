"""sitemap.xml 與 robots.txt。

sitemap 由後端產生，因為只有後端知道現在有哪些商品與報導。
裡面的網址指向**前端網域**（FRONTEND_BASE_URL），不是 API 網域。

> 注意：sitemap 的網址（api.你的網域）與裡面列的網址（www 那個網域）不同，
> 這在 Google 叫做「跨網域提交」。要生效必須在 Search Console
> 把兩個網域都驗證過 —— 兩個都是你的，加一筆 DNS TXT 就好。
> 詳細步驟見 docs/上線前必辦清單.md。
"""
from __future__ import annotations

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
        "name": cfg.get("shop_name") or "皇龍蜂蜜",
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

    # 只列 story 數量當作內容深度的訊號，不放實際內容（那應該由頁面本身提供）
    try:
        data["knowsAbout"] = ["蜂蜜", "野花蜜", "龍眼蜜", "養蜂", "基隆七堵"]
        if db.query(Story).filter(Story.is_active.is_(True)).count():
            data["hasMap"] = f"{front}/contact"
    except Exception:  # noqa: BLE001
        pass

    return data
