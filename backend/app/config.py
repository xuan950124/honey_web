from functools import lru_cache
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict

# 綠界公開的測試金鑰。
#
# 抽成常數不是為了少打幾個字，是為了**認得出來** ——
# 切正式環境時最容易漏的一步就是「環境改了、金鑰忘了換」，
# 而那個狀態下客人會被帶到正式付款頁然後每一筆都失敗。
# 有了這幾個常數，程式就能自己發現「你還在用測試金鑰」並擋下來。
TEST_PAYMENT_MERCHANT_ID = "3002607"
TEST_PAYMENT_HASH_KEY = "pwFHCqoQZGmho4w6"
TEST_PAYMENT_HASH_IV = "EkRm7iFT261dpevs"
TEST_C2C_MERCHANT_ID = "2000933"
TEST_HOME_MERCHANT_ID = "2000132"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "honey_web"

    # 連線池。要小於資料庫的 max_connections（Zeabur 的 MySQL 預設通常是 151）。
    # pool_timeout 故意設短 —— 連線要不到就快點回錯誤，
    # 讓請求卡 30 秒只會把塞車變得更嚴重。
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 5

    SECRET_KEY: str = "dev-secret-change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    ADMIN_EMAIL: str = "admin@honeyshop.com"
    ADMIN_PASSWORD: str = "admin1234"
    ADMIN_NAME: str = "網站管理員"



    # 背景工作（啟動時建表／補欄位、每小時清逾期未付款訂單）。
    #
    # 平常保持 True。兩種情況會想關掉：
    #   1. 跑多個副本時，只要讓其中一個做清理就好，其他關掉避免重複處理
    #   2. 自動化測試 —— 背景執行緒會跟測試自己的資料庫連線互相干擾
    ENABLE_BACKGROUND_JOBS: bool = True

    # ---------------- 應用環境 ----------------
    # development = 開發（未設定 SMTP 時會把信件存到 backend/outbox/，API 也會回傳連結方便測試）
    # production  = 正式（絕不回傳驗證連結）
    APP_ENV: str = "development"

    # ---------------- Email 寄送（SMTP）----------------
    # 留空則不實際寄信，改把信件內容寫到 backend/outbox/ 供開發測試
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_FROM_NAME: str = "蜂蜜工坊"
    SMTP_TLS: bool = True          # 587 埠用 STARTTLS
    SMTP_SSL: bool = False         # 465 埠用 SSL

    # 驗證信與重設密碼連結的有效時數
    VERIFY_TOKEN_HOURS: int = 24
    RESET_TOKEN_HOURS: int = 1
    # 同一個用途兩次寄信的最短間隔（秒），避免被濫用
    EMAIL_RESEND_COOLDOWN: int = 60
    # 是否要求 Email 驗證後才能下單
    REQUIRE_EMAIL_VERIFIED: bool = False

    @property
    def is_production(self) -> bool:
        return self.APP_ENV.lower() in ("production", "prod", "正式")

    @property
    def smtp_configured(self) -> bool:
        return bool(self.SMTP_HOST)

    @property
    def mail_from(self) -> str:
        return self.SMTP_FROM or self.SMTP_USER or "no-reply@localhost"

    # ---------------- 綠界 ECPay ----------------
    # stage = 測試環境（預設，用綠界公開的測試金鑰，不會真的扣款）
    # production = 正式環境（請務必換成自己後台的金鑰）
    ECPAY_ENV: str = "stage"

    # 物流可以跟金流分開切換。
    #
    # 綠界的物流與金流是**分開審核**的，物流常常先通過。
    # 兩者綁在同一個開關的話，就得等金流也過才能用真的物流 ——
    # 但其實物流一過就可以先用「貨到付款」開賣了。
    # 留空 = 跟著 ECPAY_ENV 走，不影響原本的設定。
    ECPAY_LOGISTICS_ENV: str = ""

    # 金流（全方位金流）
    ECPAY_MERCHANT_ID: str = TEST_PAYMENT_MERCHANT_ID
    ECPAY_HASH_KEY: str = TEST_PAYMENT_HASH_KEY
    ECPAY_HASH_IV: str = TEST_PAYMENT_HASH_IV

    # 物流 C2C 店到店（測試環境與金流是不同組帳號）
    ECPAY_C2C_MERCHANT_ID: str = TEST_C2C_MERCHANT_ID
    ECPAY_C2C_HASH_KEY: str = "XBERn1YOvpM9nfZc"
    ECPAY_C2C_HASH_IV: str = "h1ONHk4P4yqbl5LK"

    # 物流 宅配（黑貓 / 中華郵政）
    ECPAY_HOME_MERCHANT_ID: str = TEST_HOME_MERCHANT_ID
    ECPAY_HOME_HASH_KEY: str = "5294y06JbISpM5x9"
    ECPAY_HOME_HASH_IV: str = "v77hoKGq4kWxNNIS"

    # 綠界回呼會打到這個網址，必須是「外部連得到」的公開網址（80 或 443 埠）
    # 本機開發請用 ngrok 之類的工具取得公開網址後填入
    BACKEND_BASE_URL: str = "http://127.0.0.1:8000"
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    @staticmethod
    def _is_production(value: str) -> bool:
        return (value or "").strip().lower() in ("production", "prod", "正式")

    @property
    def payment_credentials_ok(self) -> bool:
        """金流的金鑰是不是換成自己的了。

        這是切正式時最容易漏的一步：`ECPAY_ENV` 改成 production，
        但 MerchantID／HashKey／HashIV 還是綠界公開的測試值。

        後果比忘記切還糟 —— 客人會被帶到**正式**的付款頁，
        然後每一筆都因為檢查碼或廠商編號不符而失敗；
        畫面上只會看到一句綠界的錯誤訊息，沒有人知道原因是什麼。
        所以這裡直接把它視為「還不能開賣線上付款」。
        """
        return not any((
            self.ECPAY_MERCHANT_ID.strip() == TEST_PAYMENT_MERCHANT_ID,
            self.ECPAY_HASH_KEY.strip() == TEST_PAYMENT_HASH_KEY,
            self.ECPAY_HASH_IV.strip() == TEST_PAYMENT_HASH_IV,
        ))

    @property
    def logistics_credentials_ok(self) -> bool:
        """物流的金鑰是不是換成自己的了（C2C 與宅配各一組）。"""
        test_ids = {TEST_C2C_MERCHANT_ID, TEST_HOME_MERCHANT_ID}
        return not (
            self.ECPAY_C2C_MERCHANT_ID.strip() in test_ids
            or self.ECPAY_HOME_MERCHANT_ID.strip() in test_ids
        )

    @property
    def can_sell_online_now(self) -> bool:
        """現在能不能真的收線上付款（環境是正式、而且金鑰換過了）。"""
        return self.is_ecpay_production and self.payment_credentials_ok

    @property
    def ecpay_warnings(self) -> list[str]:
        """設定看起來不對勁的地方。後台會直接列出來。

        只講「哪裡不對、要去改什麼」，不猜使用者的意圖 ——
        這幾種組合每一種都會讓錢收不到，值得講清楚。
        """
        out: list[str] = []
        if self.is_ecpay_production and not self.payment_credentials_ok:
            out.append(
                "ECPAY_ENV 已設成 production，但金流金鑰還是綠界的公開測試值。"
                "請把 ECPAY_MERCHANT_ID／ECPAY_HASH_KEY／ECPAY_HASH_IV "
                "換成綠界廠商後台「系統開發管理 → 系統介接設定」裡你自己的那一組。"
                "在換好之前，線上付款會維持關閉。"
            )
        if self.is_logistics_production and not self.logistics_credentials_ok:
            out.append(
                "物流已設成正式環境，但物流金鑰還是測試值。"
                "請填 ECPAY_C2C_*（超商店到店）與 ECPAY_HOME_*（宅配）兩組。"
            )
        if self.is_ecpay_production and not self.BACKEND_BASE_URL.startswith("https://"):
            out.append(
                f"BACKEND_BASE_URL 目前是 {self.BACKEND_BASE_URL}。"
                "綠界的付款結果通知只會打 https 的公開網址，"
                "設錯的話錢收到了、訂單卻不會變成已付款。"
            )
        return out

    @property
    def is_ecpay_production(self) -> bool:
        """金流是不是正式環境。"""
        return self._is_production(self.ECPAY_ENV)

    @property
    def is_logistics_production(self) -> bool:
        """物流是不是正式環境。沒特別設定就跟著金流。"""
        if self.ECPAY_LOGISTICS_ENV.strip():
            return self._is_production(self.ECPAY_LOGISTICS_ENV)
        return self.is_ecpay_production

    @property
    def ecpay_payment_host(self) -> str:
        return (
            "https://payment.ecpay.com.tw"
            if self.is_ecpay_production
            else "https://payment-stage.ecpay.com.tw"
        )

    @property
    def ecpay_logistics_host(self) -> str:
        return (
            "https://logistics.ecpay.com.tw"
            if self.is_logistics_production
            else "https://logistics-stage.ecpay.com.tw"
        )

    @property
    def ecpay_status(self) -> dict[str, object]:
        """綠界目前各服務的狀態，給後台顯示用。

        分開回報是因為兩者的意義完全不同：
          - 金流還在測試 → 客人的錢收不到，不能開賣線上付款
          - 物流已正式   → 可以真的寄件，也可以用貨到付款收現金
        """
        payment = self.is_ecpay_production
        logistics = self.is_logistics_production
        return {
            "payment_production": payment,
            "logistics_production": logistics,
            "payment_credentials_ok": self.payment_credentials_ok,
            "logistics_credentials_ok": self.logistics_credentials_ok,
            # 貨到付款只需要物流（代收貨款），不需要金流服務
            "can_sell_cod": logistics,
            # 線上付款（信用卡／ATM／超商代碼）要金流正式**而且**金鑰是自己的。
            # 只切環境沒換金鑰的話，客人會被帶到正式付款頁然後每筆都失敗 ——
            # 那比停在測試環境更糟，所以這裡一併擋住。
            "can_sell_online": self.can_sell_online_now,
            "warnings": self.ecpay_warnings,
        }

    def logistics_credentials(self, logistics_type: str) -> tuple[str, str, str]:
        """依物流類型取出對應的 (廠商編號, HashKey, HashIV)。

        正式環境通常兩者是同一組帳號，把 .env 裡的四組值填成一樣即可；
        測試環境綠界的 C2C 與宅配是分開的測試帳號。
        """
        if logistics_type.upper() == "HOME":
            return (
                self.ECPAY_HOME_MERCHANT_ID,
                self.ECPAY_HOME_HASH_KEY,
                self.ECPAY_HOME_HASH_IV,
            )
        return (
            self.ECPAY_C2C_MERCHANT_ID,
            self.ECPAY_C2C_HASH_KEY,
            self.ECPAY_C2C_HASH_IV,
        )

    @property
    def _credentials(self) -> str:
        """帳號密碼必須做 URL 編碼。

        連線字串的格式是 使用者:密碼@主機:埠號/資料庫，
        如果密碼裡含有 @ : / ? # 這類字元而沒有編碼，
        解析時會從錯誤的位置切開（例如密碼 "@abc123" 會讓主機變成 "abc123@localhost"）。
        """
        return f"{quote_plus(self.DB_USER)}:{quote_plus(self.DB_PASSWORD)}"

    @property
    def database_url(self) -> str:
        return (
            f"mysql+pymysql://{self._credentials}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"
        )

    @property
    def server_url(self) -> str:
        """不含 database 名稱的連線字串，用來 CREATE DATABASE。"""
        return (
            f"mysql+pymysql://{self._credentials}"
            f"@{self.DB_HOST}:{self.DB_PORT}/?charset=utf8mb4"
        )

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
