import enum
from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Enum, ForeignKey, Integer, Numeric, String, Text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# 存網址的欄位一律用 TEXT，不要用 VARCHAR。
#
# 原因是社群平台的網址長度沒有上限可言：Facebook 會把整篇貼文標題
# 做 URL 編碼塞進路徑，一個中文字變成 9 個字元（%E6%AD%A1 這樣），
# 實測一則基隆美食部落客的貼文網址是 753 個字元。
# 之前設 VARCHAR(400) 的結果就是 MySQL 直接拒絕寫入，前台看到 500 錯誤。
URL_TEXT = Text


class UserRole(str, enum.Enum):
    member = "member"   # 一般會員
    staff = "staff"     # 工作人員：可管理商品、團購、新聞、訂單


class OrderStatus(str, enum.Enum):
    pending = "pending"       # 待處理
    paid = "paid"             # 已付款
    shipped = "shipped"       # 已出貨
    completed = "completed"   # 已完成
    cancelled = "cancelled"   # 已取消


class ShippingMethod(str, enum.Enum):
    """送貨方式。對應綠界的物流類型／子類型。"""
    cvs_unimart_c2c = "cvs_unimart_c2c"   # 7-ELEVEN 交貨便（CVS / UNIMARTC2C）
    cvs_fami_c2c = "cvs_fami_c2c"         # 全家店到店（CVS / FAMIC2C）
    cvs_hilife_c2c = "cvs_hilife_c2c"     # 萊爾富店到店（CVS / HILIFEC2C）
    home_tcat = "home_tcat"               # 黑貓宅急便（HOME / TCAT）含溫層
    home_post = "home_post"               # 中華郵政（HOME / POST）


# 送貨方式 -> (綠界物流類型, 物流子類型, 顯示名稱, 是否支援代收貨款)
#
# 順序就是結帳頁的顯示順序，便宜的排前面。
# 綠界 C2C 牌價（未稅）：7-11 與全家 65 元、萊爾富 55 元，
# 所以萊爾富每筆便宜 10 元，是最有感的省運費選項。
SHIPPING_MAP: dict[str, tuple[str, str, str, bool]] = {
    ShippingMethod.cvs_hilife_c2c.value: ("CVS", "HILIFEC2C", "萊爾富超商取貨", True),
    ShippingMethod.cvs_unimart_c2c.value: ("CVS", "UNIMARTC2C", "7-ELEVEN 超商取貨", True),
    ShippingMethod.cvs_fami_c2c.value: ("CVS", "FAMIC2C", "全家超商取貨", True),
    ShippingMethod.home_post.value: ("HOME", "POST", "中華郵政宅配", False),
    ShippingMethod.home_tcat.value: ("HOME", "TCAT", "黑貓宅急便", True),
}


class PaymentMethod(str, enum.Enum):
    """付款方式。cod 走物流代收貨款，其餘走綠界全方位金流。"""
    credit = "credit"       # 信用卡
    atm = "atm"             # ATM 虛擬帳號
    cvs_code = "cvs_code"   # 超商代碼繳費
    cod = "cod"             # 貨到付款（超商／宅配代收貨款）


# 付款方式 -> (綠界 ChoosePayment 參數, 顯示名稱)
PAYMENT_MAP: dict[str, tuple[str, str]] = {
    PaymentMethod.credit.value: ("Credit", "信用卡"),
    PaymentMethod.atm.value: ("ATM", "ATM 虛擬帳號"),
    PaymentMethod.cvs_code.value: ("CVS", "超商代碼繳費"),
    PaymentMethod.cod.value: ("", "貨到付款"),
}


class PaymentStatus(str, enum.Enum):
    unpaid = "unpaid"       # 未付款
    pending = "pending"     # 已取號，等待付款（ATM／超商代碼）
    paid = "paid"           # 已付款
    failed = "failed"       # 付款失敗
    refunded = "refunded"   # 已退款


class Temperature(str, enum.Enum):
    """宅配溫層。中華郵政只支援常溫。"""
    normal = "0001"        # 常溫
    refrigerated = "0002"  # 冷藏
    frozen = "0003"        # 冷凍


class LogisticsStatus(str, enum.Enum):
    none = "none"           # 尚未建立物流單
    created = "created"     # 已建立，等待寄件
    shipped = "shipped"     # 已寄件
    arrived = "arrived"     # 已到店／配送中
    picked = "picked"       # 已取貨／已送達
    returned = "returned"   # 退貨中／已退回
    failed = "failed"       # 建立失敗


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str | None] = mapped_column(String(30))
    address: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, native_enum=False, length=20),
        default=UserRole.member,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime)
    # 累積消費金額（付款完成才計入，見 membership.record_spending）
    total_spent: Mapped[float] = mapped_column(Numeric(12, 2), default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    orders: Mapped[list["Order"]] = relationship(back_populates="user")
    tokens: Mapped[list["AuthToken"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    coupons: Mapped[list["Coupon"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    slug: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    products: Mapped[list["Product"]] = relationship(back_populates="category")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    spec: Mapped[str | None] = mapped_column(String(120))            # 例：700g / 玻璃瓶
    origin: Mapped[str | None] = mapped_column(String(120))          # 產地
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False, default=0)
    original_price: Mapped[float | None] = mapped_column(Numeric(10, 2))
    stock: Mapped[int] = mapped_column(Integer, default=0)
    image_url: Mapped[str | None] = mapped_column(URL_TEXT)          # 空值 = 前端顯示空白佔位
    is_group_buy: Mapped[bool] = mapped_column(Boolean, default=False)   # 是否為團購商品
    group_buy_min_qty: Mapped[int | None] = mapped_column(Integer)       # 團購成團門檻
    group_buy_note: Mapped[str | None] = mapped_column(String(500))
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False)    # 首頁精選
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now, onupdate=datetime.now
    )

    category: Mapped["Category | None"] = relationship(back_populates="products")
    images: Mapped[list["ProductImage"]] = relationship(
        back_populates="product", cascade="all, delete-orphan",
        order_by="ProductImage.sort_order",
    )


class ProductImage(Base):
    """商品的其他照片（工作人員可多張上傳）。"""
    __tablename__ = "product_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False
    )
    image_url: Mapped[str] = mapped_column(URL_TEXT, nullable=False)
    caption: Mapped[str | None] = mapped_column(String(150))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped["Product"] = relationship(back_populates="images")


class News(Base):
    """新聞報導 / 最新消息。"""
    __tablename__ = "news"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    summary: Mapped[str | None] = mapped_column(String(600))
    content: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str | None] = mapped_column(String(120))        # 報導媒體
    # 原文連結。Facebook 貼文的網址會把整篇標題做 URL 編碼塞進路徑，
    # 一個中文字變 9 個字元，實測 753 字元 —— 所以這裡不能用 VARCHAR，要用 TEXT。
    source_url: Mapped[str | None] = mapped_column(URL_TEXT)
    cover_url: Mapped[str | None] = mapped_column(URL_TEXT)
    category: Mapped[str] = mapped_column(String(40), default="news")  # news / media
    published_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Story(Base):
    """品牌故事 / 養蜂人的故事。"""
    __tablename__ = "stories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(300))
    content: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(URL_TEXT)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    # 訂單頁的存取碼。
    #
    # 訂單編號是「時間戳 + 三位隨機數」，看得出規律也猜得到 ——
    # 只憑編號就能查訂單的話，別人可以撈到你客人的姓名、電話、地址。
    # 所以查訂單要嘛是本人或工作人員登入，要嘛得帶這組隨機碼。
    access_token: Mapped[str | None] = mapped_column(String(40))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    receiver_name: Mapped[str] = mapped_column(String(100), nullable=False)
    receiver_phone: Mapped[str] = mapped_column(String(30), nullable=False)
    receiver_address: Mapped[str] = mapped_column(String(255), nullable=False)
    note: Mapped[str | None] = mapped_column(String(400))
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), default=0)      # 商品小計
    member_discount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)   # 會員等級折扣
    coupon_code: Mapped[str | None] = mapped_column(String(32))                 # 使用的折價券
    coupon_discount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)   # 折價券折抵
    shipping_fee: Mapped[float] = mapped_column(Numeric(10, 2), default=0)  # 運費（已扣免運券）
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)  # 應付總額
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, native_enum=False, length=20),
        default=OrderStatus.pending, nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    # ---------------- 送貨 ----------------
    shipping_method: Mapped[ShippingMethod] = mapped_column(
        Enum(ShippingMethod, native_enum=False, length=30),
        default=ShippingMethod.cvs_unimart_c2c, nullable=False,
    )
    # 超商取貨：買家在綠界電子地圖選的門市
    cvs_store_id: Mapped[str | None] = mapped_column(String(10))
    cvs_store_name: Mapped[str | None] = mapped_column(String(60))
    cvs_address: Mapped[str | None] = mapped_column(String(120))
    cvs_telephone: Mapped[str | None] = mapped_column(String(30))
    cvs_outside: Mapped[str | None] = mapped_column(String(1))   # 1=離島門市
    # 宅配
    receiver_zipcode: Mapped[str | None] = mapped_column(String(6))
    temperature: Mapped[str] = mapped_column(String(4), default=Temperature.normal.value)
    specification: Mapped[str] = mapped_column(String(4), default="0001")  # 材積 60cm
    distance: Mapped[str] = mapped_column(String(2), default="00")         # 00同縣市 01外縣市 02離島

    # ---------------- 付款 ----------------
    payment_method: Mapped[PaymentMethod] = mapped_column(
        Enum(PaymentMethod, native_enum=False, length=20),
        default=PaymentMethod.credit, nullable=False,
    )
    payment_status: Mapped[PaymentStatus] = mapped_column(
        Enum(PaymentStatus, native_enum=False, length=20),
        default=PaymentStatus.unpaid, nullable=False,
    )
    is_collection: Mapped[bool] = mapped_column(Boolean, default=False)  # 是否代收貨款
    ecpay_trade_no: Mapped[str | None] = mapped_column(String(30))       # 綠界交易編號
    payment_type: Mapped[str | None] = mapped_column(String(40))         # 實際付款方式
    paid_at: Mapped[datetime | None] = mapped_column(DateTime)
    # ATM／超商代碼取號後的繳費資訊
    payment_no: Mapped[str | None] = mapped_column(String(40))     # 繳費代碼／虛擬帳號
    payment_bank_code: Mapped[str | None] = mapped_column(String(10))
    payment_expire_date: Mapped[str | None] = mapped_column(String(30))
    # 重新付款用。綠界的 MerchantTradeNo 不可重複，
    # 所以第二次以後的付款會送出 {order_no}R2、{order_no}R3…，這裡記下最後一次送出的值。
    payment_trade_no: Mapped[str | None] = mapped_column(String(30))
    payment_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payment_message: Mapped[str | None] = mapped_column(String(200))  # 最近一次失敗原因
    cancel_reason: Mapped[str | None] = mapped_column(String(200))    # 取消原因（逾期未付款等）
    stock_restored: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # ---------------- 物流 ----------------
    logistics_status: Mapped[LogisticsStatus] = mapped_column(
        Enum(LogisticsStatus, native_enum=False, length=20),
        default=LogisticsStatus.none, nullable=False,
    )
    allpay_logistics_id: Mapped[str | None] = mapped_column(String(30))  # 綠界物流交易編號
    cvs_payment_no: Mapped[str | None] = mapped_column(String(20))       # 寄貨編號
    cvs_validation_no: Mapped[str | None] = mapped_column(String(20))    # 驗證碼（7-11 才有）
    booking_note: Mapped[str | None] = mapped_column(String(60))         # 宅配託運單號
    logistics_message: Mapped[str | None] = mapped_column(String(300))   # 最新物流狀態說明
    logistics_updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    # 是否已計入會員累積消費。用旗標而不是每次重算，
    # 避免付款通知重送或狀態反覆變更時重複累加。
    spending_counted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped["User | None"] = relationship(back_populates="orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id"))
    product_name: Mapped[str] = mapped_column(String(150), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    order: Mapped["Order"] = relationship(back_populates="items")


class SiteSetting(Base):
    """聯絡方式等站台設定，工作人員可於後台修改。"""
    __tablename__ = "site_settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)


class EcpayLog(Base):
    """綠界回呼與 API 往來記錄，出問題時可回溯查證。"""
    __tablename__ = "ecpay_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)   # payment / logistics / map / create
    order_no: Mapped[str | None] = mapped_column(String(30), index=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    message: Mapped[str | None] = mapped_column(String(300))
    payload: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class TokenPurpose(str, enum.Enum):
    verify_email = "verify_email"       # 驗證信箱
    reset_password = "reset_password"   # 重設密碼


class AuthToken(Base):
    """信箱驗證與重設密碼用的一次性權杖。

    安全性：資料庫只存權杖的 SHA-256 雜湊，不存原始字串。
    就算資料庫外洩，也無法反推出可用的連結。
    """
    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    purpose: Mapped[TokenPurpose] = mapped_column(
        Enum(TokenPurpose, native_enum=False, length=30), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    user: Mapped["User"] = relationship(back_populates="tokens")


class MemberTier(Base):
    """會員等級。依累積消費金額自動判定，每筆訂單享固定折扣。"""
    __tablename__ = "member_tiers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(40), nullable=False)          # 例：金卡會員
    min_spent: Mapped[float] = mapped_column(Numeric(12, 2), default=0)    # 升級門檻（累積消費）
    discount_percent: Mapped[float] = mapped_column(Numeric(5, 2), default=0)  # 每筆訂單折扣 %
    note: Mapped[str | None] = mapped_column(String(200))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class CouponKind(str, enum.Enum):
    fixed = "fixed"                  # 滿額折固定金額
    percent = "percent"              # 百分比折扣
    free_shipping = "free_shipping"  # 免運


class CouponTrigger(str, enum.Enum):
    register = "register"        # 新會員完成信箱驗證時發放
    total_spent = "total_spent"  # 累積消費達門檻時發放


class CouponRule(Base):
    """自動發券的規則。工作人員可於後台調整。"""
    __tablename__ = "coupon_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    trigger: Mapped[CouponTrigger] = mapped_column(
        Enum(CouponTrigger, native_enum=False, length=20),
        default=CouponTrigger.total_spent, nullable=False,
    )
    threshold: Mapped[float] = mapped_column(Numeric(12, 2), default=0)   # 累積消費門檻

    kind: Mapped[CouponKind] = mapped_column(
        Enum(CouponKind, native_enum=False, length=20),
        default=CouponKind.fixed, nullable=False,
    )
    value: Mapped[float] = mapped_column(Numeric(10, 2), default=0)          # 折抵金額或百分比
    min_order_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)  # 使用門檻
    max_discount: Mapped[float | None] = mapped_column(Numeric(10, 2))       # 百分比券的折抵上限
    valid_days: Mapped[int] = mapped_column(Integer, default=90)             # 發放後有效天數

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Coupon(Base):
    """實際發給某位會員的折價券。一張券只能用一次。"""
    __tablename__ = "coupons"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    rule_id: Mapped[int | None] = mapped_column(ForeignKey("coupon_rules.id"))

    name: Mapped[str] = mapped_column(String(60), nullable=False)
    kind: Mapped[CouponKind] = mapped_column(
        Enum(CouponKind, native_enum=False, length=20), nullable=False
    )
    value: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    min_order_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    max_discount: Mapped[float | None] = mapped_column(Numeric(10, 2))

    expires_at: Mapped[datetime | None] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)
    used_order_no: Mapped[str | None] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)

    user: Mapped["User"] = relationship(back_populates="coupons")
