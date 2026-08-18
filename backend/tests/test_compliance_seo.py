"""法規揭露與 SEO 的測試。

法規那部分的重點不是「頁面存不存在」，而是**該講的話有沒有在該出現的地方**——
例如退換貨的例外情形，法規要求「必須在消費者下單前明確告知」，
只放在頁尾的連結裡不算數。

執行：
    cd backend
    python tests/test_compliance_seo.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from xml.etree import ElementTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
# 背景工作會在另一個執行緒開資料庫連線，跟測試自己的連線互相干擾
# （SQLite 的 StaticPool 只有一條連線，交易會互相蓋掉）。測試一律關掉。
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"
os.environ.setdefault("CORS_ORIGINS", "https://huanglong-honey.com")
os.environ.setdefault("FRONTEND_BASE_URL", "https://huanglong-honey.com")
os.environ.setdefault("BACKEND_BASE_URL", "https://api.huanglong-honey.com")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app import database, main, policies  # noqa: E402
from app.models import Base, News, Product, SiteSetting  # noqa: E402
from app.routers.content import DEFAULT_SETTINGS  # noqa: E402

FRONT = "https://huanglong-honey.com"
ROOT = Path(__file__).resolve().parent.parent.parent

passed = 0
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(f"{name}{f' — {detail}' if detail else ''}")
        print(f"  FAIL {name}{f' — {detail}' if detail else ''}")


def make_client(seed=True):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    database.engine = engine
    database.SessionLocal = Session

    if seed:
        db = Session()
        db.add(Product(id=1, name="龍眼蜜 700g", price=680, stock=10, is_active=True))
        db.add(Product(id=2, name="已下架的商品", price=100, stock=0, is_active=False))
        db.add(News(id=1, title="媒體報導", is_active=True))
        db.add(News(id=2, title="隱藏的消息", is_active=False))
        db.add(SiteSetting(key="shop_name", value="皇龍蜂蜜"))
        db.commit()
        db.close()

    from fastapi.testclient import TestClient
    return TestClient(main.app, raise_server_exceptions=False), Session


# ---------------------------------------------------------------- 政策內容

def test_policy_content():
    print("\n[三份政策的內容有講到該講的]")
    client, _ = make_client()
    with client:
        r = client.get("/api/policies")
        check("政策端點回 200", r.status_code == 200, str(r.status_code))
        data = r.json()

    for key in ("policy_privacy", "policy_terms", "policy_refund", "policy_checkout_notice"):
        check(f"{key} 有內容", len(data.get(key, "")) > 50, str(len(data.get(key, ""))))

    privacy = data["policy_privacy"]
    # 個資法要求告知：蒐集目的、期間、方式、當事人權利
    for topic in ("蒐集", "目的", "保存期間", "權利", "更正", "刪除"):
        check(f"隱私權政策提到「{topic}」", topic in privacy)
    check("隱私權政策說明不保存卡號", "不會" in privacy and "卡號" in privacy)
    check("隱私權政策提到物流業者會拿到資料", "物流" in privacy)

    refund = data["policy_refund"]
    # 這是最關鍵的一段：要排除七天猶豫期就必須引用這個準則
    check("退換貨政策引用了正確的法規名稱",
          "通訊交易解除權合理例外情事適用準則" in refund)
    check("退換貨政策說明食品不適用七天猶豫期",
          "七天" in refund and "食品" in refund)
    check("退換貨政策仍保障瑕疵商品",
          "破損" in refund and "退款" in refund)
    check("退換貨政策說明結晶是正常現象", "結晶" in refund)
    check("退換貨政策說明超商未取貨的處理", "未取" in refund)

    terms = data["policy_terms"]
    check("服務條款說明契約何時成立", "契約" in terms and "成立" in terms)
    check("服務條款保留標價錯誤時取消訂單的權利", "標價錯誤" in terms)
    check("服務條款說明蜂蜜的自然差異", "結晶" in terms or "顏色" in terms)

    notice = data["policy_checkout_notice"]
    check("結帳告知夠短（要放在按鈕上方）", len(notice) < 200, f"{len(notice)} 字")
    check("結帳告知有講到不適用七天猶豫期", "七天猶豫期" in notice)
    check("結帳告知也有講我們會負責的情況", "破損" in notice or "負責" in notice)


def test_policy_placeholders_replaced():
    print("\n[政策裡的店名佔位符會被換掉]")
    client, Session = make_client()
    with client:
        data = client.get("/api/policies").json()

    for key, text in data.items():
        check(f"{key} 沒有殘留 {{shop_name}}", "{shop_name}" not in text,
              text[:80] if "{shop_name}" in text else "")
    check("政策裡出現實際店名", "皇龍蜂蜜" in data["policy_privacy"])

    # 沒設定店名時要退回一個合理的字，不能出現空白或「None」
    db = Session()
    db.query(SiteSetting).filter(SiteSetting.key == "shop_name").delete()
    db.commit()
    db.close()
    with client:
        data = client.get("/api/policies").json()
    check("沒設店名時用「本站」", "本站" in data["policy_privacy"])
    check("沒設店名時不會出現 None", "None" not in data["policy_privacy"])


def test_policy_editable():
    print("\n[政策可以在後台改，清空會回到草稿]")
    client, Session = make_client()

    db = Session()
    db.add(SiteSetting(key="policy_terms", value="我們自己寫的條款"))
    db.commit()
    db.close()

    with client:
        data = client.get("/api/policies").json()
    check("改過的內容會生效", data["policy_terms"] == "我們自己寫的條款", data["policy_terms"][:40])
    check("沒改的仍是草稿", len(data["policy_privacy"]) > 500)

    db = Session()
    db.query(SiteSetting).filter(SiteSetting.key == "policy_terms").update({"value": ""})
    db.commit()
    db.close()
    with client:
        data = client.get("/api/policies").json()
    check("清空後回到預設草稿", "服務條款" in data["policy_terms"] or len(data["policy_terms"]) > 500)


# ---------------------------------------------------------------- 食品標示

def test_food_label_fields():
    print("\n[食品標示的欄位都在]")
    from app.schemas import ProductIn, ProductOut

    required = {
        "ingredients": "內容物名稱",
        "net_weight": "淨重／內容量",
        "origin": "原產地",
        "shelf_life": "有效日期／保存期限",
        "storage": "保存方式",
        "nutrition": "營養標示",
        "allergens": "過敏原",
        "additives": "食品添加物",
    }
    for key, label in required.items():
        check(f"商品可以填「{label}」", key in ProductIn.model_fields, key)
        check(f"商品會回傳「{label}」", key in ProductOut.model_fields, key)
        check(f"{key} 在資料表裡", key in Product.__table__.c, key)

    # 共用預設值與嬰兒警語
    for key in ("food_default_ingredients", "food_default_storage",
                "food_default_allergens", "food_infant_warning"):
        check(f"設定有 {key}", key in DEFAULT_SETTINGS, key)

    warning = DEFAULT_SETTINGS["food_infant_warning"]
    check("預設有嬰兒警語", "一歲" in warning and "嬰兒" in warning, warning)
    check("警語有講原因（肉毒桿菌）", "肉毒桿菌" in warning, warning)

    ingredients = DEFAULT_SETTINGS["food_default_ingredients"]
    check("內容物預設寫明 100% 蜂蜜", "100%" in ingredients and "蜂蜜" in ingredients,
          ingredients)


def test_business_fields():
    print("\n[業者資訊的欄位都在]")
    for key, label in [
        ("business_name", "商號名稱"),
        ("business_tax_id", "統一編號"),
        ("food_registration_no", "食品業者登錄字號"),
        ("business_owner", "負責人"),
        ("business_address", "廠商地址"),
        ("business_phone", "廠商電話"),
    ]:
        check(f"設定有「{label}」", key in DEFAULT_SETTINGS, key)
        check(f"{label} 預設留空（等店家自己填）", DEFAULT_SETTINGS[key] == "",
              repr(DEFAULT_SETTINGS[key]))


# ---------------------------------------------------------------- SEO

def test_sitemap():
    print("\n[sitemap.xml]")
    client, _ = make_client()
    with client:
        r = client.get("/sitemap.xml")

    check("回 200", r.status_code == 200, str(r.status_code))
    check("Content-Type 是 XML", "xml" in r.headers.get("content-type", ""),
          r.headers.get("content-type"))

    root = ElementTree.fromstring(r.text)
    ns = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    locs = [e.text for e in root.iter(f"{ns}loc")]
    check("是合法的 XML 且解析得出網址", len(locs) > 5, str(len(locs)))

    for path in ("/", "/products", "/group-buy", "/news", "/story", "/contact",
                 "/privacy", "/terms", "/refund"):
        check(f"包含 {path}", f"{FRONT}{path}" in locs or (path == "/" and f"{FRONT}/" in locs))

    check("包含上架中的商品", f"{FRONT}/products/1" in locs, str(locs))
    check("不含已下架的商品", f"{FRONT}/products/2" not in locs,
          "把下架商品交給 Google 收錄，使用者點進去看到 404 會扣分")
    check("包含公開的報導", f"{FRONT}/news/1" in locs)
    check("不含隱藏的報導", f"{FRONT}/news/2" not in locs)

    check("網址指向前台網域不是 API 網域",
          all(u.startswith(FRONT) for u in locs), str([u for u in locs if not u.startswith(FRONT)]))
    check("沒有重複的網址", len(locs) == len(set(locs)), str(len(locs) - len(set(locs))))

    # 後台與訂單頁絕對不能出現在 sitemap
    for secret in ("/admin", "/cart", "/order", "/member", "/login"):
        check(f"不含 {secret}", not any(secret in u for u in locs))


def test_sitemap_survives_broken_db():
    print("\n[資料庫壞掉時 sitemap 仍給得出靜態頁]")
    engine = create_engine("mysql+pymysql://nobody:nothing@127.0.0.1:1/nope",
                           pool_pre_ping=False)
    database.engine = engine
    from fastapi.testclient import TestClient
    original_retry, original_attempts = main.INIT_RETRY_SECONDS, main.INIT_MAX_ATTEMPTS_AT_BOOT
    main.INIT_RETRY_SECONDS = 0
    main.INIT_MAX_ATTEMPTS_AT_BOOT = 1
    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            r = client.get("/sitemap.xml")
        # 資料庫連不上時，商品那段會被跳過，但靜態頁仍要列得出來
        check("仍回得出 sitemap（不是 500）", r.status_code in (200, 503), str(r.status_code))
        if r.status_code == 200:
            check("靜態頁還在", f"{FRONT}/products" in r.text)
    finally:
        main.INIT_RETRY_SECONDS = original_retry
        main.INIT_MAX_ATTEMPTS_AT_BOOT = original_attempts
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


def test_robots():
    print("\n[robots.txt]")
    client, _ = make_client()
    with client:
        r = client.get("/robots.txt")

    check("回 200", r.status_code == 200, str(r.status_code))
    body = r.text
    check("允許一般收錄", "Allow: /" in body)
    check("有宣告 sitemap", "Sitemap:" in body and "/sitemap.xml" in body)
    for path in ("/admin", "/cart", "/order", "/member", "/login"):
        check(f"擋掉 {path}", f"Disallow: {path}" in body,
              "訂單頁網址帶存取碼，被收錄等於外流")


def test_structured_data():
    print("\n[結構化資料]")
    client, Session = make_client()
    db = Session()
    for k, v in [("contact_phone", "0930081500"),
                 ("contact_address", "基隆市七堵區華新一路89-6號"),
                 ("contact_email", "a@example.com"),
                 ("facebook_url", "https://facebook.com/x")]:
        db.add(SiteSetting(key=k, value=v))
    db.commit()
    db.close()

    with client:
        r = client.get("/api/seo/structured-data")
    check("回 200", r.status_code == 200, str(r.status_code))
    data = r.json()

    check("型別是 LocalBusiness", data.get("@type") == "LocalBusiness", str(data.get("@type")))
    check("有 @context", data.get("@context") == "https://schema.org")
    check("有店名", data.get("name") == "皇龍蜂蜜", str(data.get("name")))
    check("網址指向前台", data.get("url") == FRONT, str(data.get("url")))
    check("有電話", data.get("telephone") == "0930081500")
    check("有地址且標明台灣", data.get("address", {}).get("addressCountry") == "TW",
          str(data.get("address")))
    check("地址帶完整門牌", "89-6" in str(data.get("address")), str(data.get("address")))
    check("有社群連結", "https://facebook.com/x" in (data.get("sameAs") or []))
    check("有在地關鍵字", "基隆七堵" in (data.get("knowsAbout") or []),
          str(data.get("knowsAbout")))

    # 沒填的欄位不該出現空值，那會讓 Google 判定資料無效
    for key, value in data.items():
        check(f"{key} 不是空值", value not in ("", None, [], {}), f"{key}={value!r}")


# ---------------------------------------------------------------- 前端有用到

def test_frontend_wiring():
    print("\n[前端真的有用到這些東西]")
    src = ROOT / "frontend/src"

    cart = (src / "pages/Cart.jsx").read_text("utf-8")
    check("結帳頁有載入退換貨告知", "policy_checkout_notice" in cart)
    check("告知放在送出按鈕之前",
          cart.index("checkout-notice") < cart.index('type="submit" form="checkout-form"'),
          "法規要求下單前就要看得到")

    footer = (src / "components/Footer.jsx").read_text("utf-8")
    for path in ("/privacy", "/terms", "/refund"):
        check(f"頁尾有 {path} 連結", path in footer)
    check("頁尾有業者資訊區", "food_registration_no" in footer and "business_tax_id" in footer)

    detail = (src / "pages/ProductDetail.jsx").read_text("utf-8")
    check("商品頁有食品標示區", "食品標示" in detail)
    check("商品頁有嬰兒警語", "food_infant_warning" in detail)
    check("商品頁有 Product 結構化資料", "'@type': 'Product'" in detail)
    check("結構化資料有價格", "priceCurrency" in detail and "TWD" in detail)
    check("結構化資料有庫存狀態", "InStock" in detail and "OutOfStock" in detail)

    meta = (src / "components/SiteMeta.jsx").read_text("utf-8")
    for tag in ("og:description", "og:url", "og:site_name", "twitter:card"):
        check(f"SiteMeta 有設 {tag}", tag in meta)
    check("SiteMeta 有設 canonical", "canonical" in meta)

    index = (ROOT / "frontend/index.html").read_text("utf-8")
    # 這一份才是 LINE / FB 分享預覽真正讀到的（它們不執行 JS）
    for tag in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
        check(f"index.html 靜態就有 {tag}", tag in index,
              "LINE 與 FB 不執行 JS，只讀得到這一份")
    check("index.html 有 canonical", 'rel="canonical"' in index)
    check("index.html 的 title 是完整版",
          "皇龍蜂蜜｜基隆七堵在地蜂場" in index, "不要被 JS 蓋成只剩店名")

    entry = (ROOT / "frontend/docker-entrypoint.d/40-app-config.sh").read_text("utf-8")
    check("啟動時會產生 robots.txt", "robots.txt" in entry)
    check("robots.txt 會指向 sitemap", "sitemap.xml" in entry)

    app_jsx = (src / "App.jsx").read_text("utf-8")
    for path in ("/privacy", "/terms", "/refund", "policies"):
        check(f"App 有註冊 {path} 路由", path in app_jsx)


if __name__ == "__main__":
    print("=" * 60)
    print("法規揭露與 SEO 測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_policy_content, test_policy_placeholders_replaced, test_policy_editable,
        test_food_label_fields, test_business_fields,
        test_sitemap, test_sitemap_survives_broken_db, test_robots, test_structured_data,
        test_frontend_wiring,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
