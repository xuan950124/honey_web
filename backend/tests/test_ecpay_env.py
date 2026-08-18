"""綠界金流與物流分開切換環境的測試。

起因：綠界的金流與物流是**分開審核**的。實際遇到的狀況是
物流「已開通」但金流還在「審核中」（3~5 個工作日）。

原本一個 ECPAY_ENV 同時控制兩者，等於物流過了也不能用 ——
但其實物流一過就可以先用「貨到付款」開賣，那筆錢由綠界代收。

最危險的組合是「物流正式 + 金流測試」：
店家真的在出貨了，客人卻被帶到綠界的**測試**付款頁，
刷了也收不到錢。所以那種狀態下線上付款一定要擋掉。

執行：
    cd backend
    python tests/test_ecpay_env.py
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("DB_URL", "sqlite://")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-in-production")
os.environ["ENABLE_BACKGROUND_JOBS"] = "false"

from app.config import Settings  # noqa: E402

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


def make(payment="stage", logistics=""):
    return Settings(ECPAY_ENV=payment, ECPAY_LOGISTICS_ENV=logistics)


def test_default_follows_payment():
    print("\n[沒特別設定時物流跟著金流走]")
    for env in ("stage", "production"):
        s = make(env)
        check(f"金流 {env} → 物流也是 {env}",
              s.is_logistics_production == s.is_ecpay_production,
              f"{s.is_ecpay_production} vs {s.is_logistics_production}")

    s = make("production")
    check("兩邊都正式時主機都是正式",
          "payment.ecpay.com.tw" in s.ecpay_payment_host
          and "logistics.ecpay.com.tw" in s.ecpay_logistics_host
          and "stage" not in s.ecpay_payment_host
          and "stage" not in s.ecpay_logistics_host,
          f"{s.ecpay_payment_host} / {s.ecpay_logistics_host}")

    s = make("stage")
    check("兩邊都測試時主機都是測試",
          "stage" in s.ecpay_payment_host and "stage" in s.ecpay_logistics_host,
          f"{s.ecpay_payment_host} / {s.ecpay_logistics_host}")


def test_split():
    print("\n[物流可以單獨切成正式]")
    s = make(payment="stage", logistics="production")

    check("金流仍是測試", s.is_ecpay_production is False)
    check("物流已是正式", s.is_logistics_production is True)
    check("金流主機是測試站", "payment-stage" in s.ecpay_payment_host, s.ecpay_payment_host)
    check("物流主機是正式站",
          "logistics.ecpay.com.tw" in s.ecpay_logistics_host
          and "stage" not in s.ecpay_logistics_host, s.ecpay_logistics_host)

    status = s.ecpay_status
    check("可以賣貨到付款", status["can_sell_cod"] is True)
    check("不能賣線上付款", status["can_sell_online"] is False)

    # 反過來也要能設（雖然實務上少見）
    r = make(payment="production", logistics="stage")
    check("金流正式、物流測試也設得出來",
          r.is_ecpay_production is True and r.is_logistics_production is False)


def test_env_value_parsing():
    print("\n[環境值的各種寫法]")
    for value in ("production", "Production", "PRODUCTION", "prod", "正式", "  production  "):
        check(f"「{value}」視為正式", make(value).is_ecpay_production is True, value)
    for value in ("stage", "Stage", "test", "", "  ", "yes", "1", "true"):
        check(f"「{value}」不視為正式", make(value).is_ecpay_production is False, value)

    # 留空的物流設定要退回跟隨金流，而不是被當成 stage
    check("物流留空時跟隨金流（正式）",
          make("production", "").is_logistics_production is True)
    check("物流只有空白時也跟隨金流",
          make("production", "   ").is_logistics_production is True)


def test_status_shape():
    print("\n[回給前端的狀態]")
    keys = {"payment_production", "logistics_production", "can_sell_cod", "can_sell_online"}
    for payment, logistics in [("stage", ""), ("stage", "production"),
                               ("production", ""), ("production", "stage")]:
        status = make(payment, logistics).ecpay_status
        check(f"{payment}/{logistics or '（跟隨）'} 欄位齊全",
              set(status) == keys, str(set(status)))
        check(f"{payment}/{logistics or '（跟隨）'} 都是布林值",
              all(isinstance(v, bool) for v in status.values()), str(status))

    # 貨到付款只需要物流，線上付款只需要金流
    s = make("stage", "production").ecpay_status
    check("貨到付款只看物流", s["can_sell_cod"] == s["logistics_production"])
    check("線上付款只看金流", s["can_sell_online"] == s["payment_production"])


def test_cod_only_mode_blocks_online_payment():
    print("\n[物流正式＋金流測試 → 只准貨到付款]")
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app import database, main
    from app.config import settings as live
    from app.models import Base, Product

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    database.engine = engine
    database.SessionLocal = Session

    db = Session()
    db.add(Product(id=1, name="龍眼蜜", price=680, stock=10))
    db.commit()
    db.close()

    original = (live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV)
    live.ECPAY_ENV = "stage"
    live.ECPAY_LOGISTICS_ENV = "production"

    try:
        with TestClient(main.app, raise_server_exceptions=False) as client:
            options = client.get("/api/orders/checkout-options").json()

            by_value = {p["value"]: p for p in options["payment"]}
            check("貨到付款可用", by_value["cod"]["disabled"] is False)
            for method in ("credit", "atm", "cvs_code"):
                check(f"{method} 被停用", by_value[method]["disabled"] is True)
                check(f"{method} 有說明原因",
                      "審核" in (by_value[method]["disabled_reason"] or ""),
                      str(by_value[method]["disabled_reason"]))
            check("貨到付款沒有停用原因", by_value["cod"]["disabled_reason"] is None)

            status = options["ecpay_status"]
            check("狀態有傳給前端", status.get("can_sell_cod") is True
                  and status.get("can_sell_online") is False, str(status))

            # 重點：直接打 API 也要擋得住，不能只擋畫面
            order = {
                "receiver_name": "測試", "receiver_phone": "0912345678",
                "items": [{"product_id": 1, "quantity": 1}],
                "shipping_method": "cvs_unimart_c2c", "payment_method": "credit",
                "cvs_store_id": "991182", "cvs_store_name": "測試門市",
            }
            r = client.post("/api/orders", json=order)
            check("繞過畫面直接下信用卡訂單被擋", r.status_code == 400, str(r.status_code))
            check("錯誤訊息看得懂",
                  "貨到付款" in r.json().get("detail", ""), str(r.json().get("detail")))

            r = client.post("/api/orders", json={**order, "payment_method": "cod"})
            check("貨到付款下得了單", r.status_code == 201, str(r.status_code)[:200])

        # 兩邊都測試時不擋（開發中要能測所有付款方式）
        live.ECPAY_LOGISTICS_ENV = "stage"
        with TestClient(main.app, raise_server_exceptions=False) as client:
            options = client.get("/api/orders/checkout-options").json()
            check("兩邊都測試時不停用任何付款方式",
                  not any(p["disabled"] for p in options["payment"]),
                  str([p["value"] for p in options["payment"] if p["disabled"]]))

        # 兩邊都正式時也不擋
        live.ECPAY_ENV = "production"
        live.ECPAY_LOGISTICS_ENV = "production"
        with TestClient(main.app, raise_server_exceptions=False) as client:
            options = client.get("/api/orders/checkout-options").json()
            check("兩邊都正式時不停用任何付款方式",
                  not any(p["disabled"] for p in options["payment"]))
    finally:
        live.ECPAY_ENV, live.ECPAY_LOGISTICS_ENV = original
        main.DB_STATE.update({"ready": False, "error": None, "attempts": 0})


def test_frontend_wiring():
    print("\n[前端有接上]")
    cart = (ROOT / "frontend/src/pages/Cart.jsx").read_text("utf-8")
    check("結帳頁會停用被擋的付款方式", "p.disabled" in cart)
    check("結帳頁會顯示停用原因", "disabled_reason" in cart)
    check("預設選項被停用時會自動換一個", "usable" in cart)
    check("測試卡號改看 ecpay_status", "ecpay_status?.payment_production" in cart)
    check("物流已正式時不顯示測試卡號",
          "logistics_production" in cart,
          "真的在賣了還顯示測試卡號會讓客人困惑")

    dash = (ROOT / "frontend/src/pages/admin/AdminDashboard.jsx").read_text("utf-8")
    check("後台分開顯示金流與物流", "can_sell_cod" in dash and "can_sell_online" in dash)
    check("後台說明可以先賣貨到付款", "貨到付款" in dash)
    check("後台講出要改哪個環境變數", "ECPAY_LOGISTICS_ENV" in dash)

    env = (ROOT / "backend/.env.example").read_text("utf-8")
    check(".env.example 有這個設定", "ECPAY_LOGISTICS_ENV" in env)
    check(".env.example 說明留空的行為", "跟著 ECPAY_ENV" in env)


if __name__ == "__main__":
    print("=" * 60)
    print("綠界環境切換測試")
    print("=" * 60)
    logging.disable(logging.CRITICAL)

    for fn in (
        test_default_follows_payment, test_split, test_env_value_parsing,
        test_status_shape, test_cod_only_mode_blocks_online_payment,
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
