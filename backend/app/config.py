from functools import lru_cache
from urllib.parse import quote_plus

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_USER: str = "root"
    DB_PASSWORD: str = ""
    DB_NAME: str = "honey_web"

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

    # 金流（全方位金流）
    ECPAY_MERCHANT_ID: str = "3002607"
    ECPAY_HASH_KEY: str = "pwFHCqoQZGmho4w6"
    ECPAY_HASH_IV: str = "EkRm7iFT261dpevs"

    # 物流 C2C 店到店（測試環境與金流是不同組帳號）
    ECPAY_C2C_MERCHANT_ID: str = "2000933"
    ECPAY_C2C_HASH_KEY: str = "XBERn1YOvpM9nfZc"
    ECPAY_C2C_HASH_IV: str = "h1ONHk4P4yqbl5LK"

    # 物流 宅配（黑貓 / 中華郵政）
    ECPAY_HOME_MERCHANT_ID: str = "2000132"
    ECPAY_HOME_HASH_KEY: str = "5294y06JbISpM5x9"
    ECPAY_HOME_HASH_IV: str = "v77hoKGq4kWxNNIS"

    # 綠界回呼會打到這個網址，必須是「外部連得到」的公開網址（80 或 443 埠）
    # 本機開發請用 ngrok 之類的工具取得公開網址後填入
    BACKEND_BASE_URL: str = "http://127.0.0.1:8000"
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    @property
    def is_ecpay_production(self) -> bool:
        return self.ECPAY_ENV.lower() in ("production", "prod", "正式")

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
            if self.is_ecpay_production
            else "https://logistics-stage.ecpay.com.tw"
        )

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
