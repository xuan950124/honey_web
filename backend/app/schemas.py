from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import (
    CouponKind, CouponTrigger, LogisticsStatus, OrderStatus, PaymentMethod,
    PaymentStatus, ShippingMethod, UserRole,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- 會員 ----------
class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=64)
    name: str = Field(min_length=1, max_length=100)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=255)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserUpdate(BaseModel):
    name: str | None = None
    phone: str | None = None
    address: str | None = None


class UserOut(ORMModel):
    id: int
    email: EmailStr
    name: str
    phone: str | None = None
    address: str | None = None
    role: UserRole
    is_active: bool
    email_verified: bool = False
    email_verified_at: datetime | None = None
    total_spent: float = 0
    created_at: datetime | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
    # 開發環境（未設定 SMTP）會附上驗證連結，方便直接測試；正式環境永遠為 None
    dev_verify_url: str | None = None


# ---------- 信箱驗證 / 密碼 ----------
class EmailIn(BaseModel):
    email: EmailStr


class TokenIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)


class PasswordResetIn(BaseModel):
    token: str = Field(min_length=8, max_length=200)
    password: str = Field(min_length=6, max_length=64)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=64)


class SimpleMessage(BaseModel):
    ok: bool = True
    message: str
    # 只有開發環境（未設定 SMTP）才會有值，方便不用真的收信就能測試
    dev_url: str | None = None


# ---------- 分類 ----------
class CategoryIn(BaseModel):
    name: str
    slug: str
    sort_order: int = 0


class CategoryOut(ORMModel):
    id: int
    name: str
    slug: str
    sort_order: int


# ---------- 商品 ----------
class ProductImageOut(ORMModel):
    id: int
    image_url: str
    caption: str | None = None
    sort_order: int


class FoodLabel(BaseModel):
    """食品標示。網路販售包裝食品，這些在購買前就要揭露。"""
    ingredients: str | None = None   # 內容物名稱
    net_weight: str | None = None    # 淨重／內容量
    shelf_life: str | None = None    # 有效日期／保存期限
    storage: str | None = None       # 保存方式
    nutrition: str | None = None     # 營養標示
    allergens: str | None = None     # 過敏原
    additives: str | None = None     # 食品添加物


class ProductIn(FoodLabel):
    name: str = Field(min_length=1, max_length=150)
    subtitle: str | None = None
    description: str | None = None
    spec: str | None = None
    origin: str | None = None
    price: float = 0
    original_price: float | None = None
    stock: int = 0
    image_url: str | None = None
    is_group_buy: bool = False
    group_buy_min_qty: int | None = None
    group_buy_note: str | None = None
    is_featured: bool = False
    is_active: bool = True
    # 看得到但不能買（試賣中、等檢驗報告…）。工作人員仍可下單測試
    is_purchasable: bool = True
    unavailable_note: str | None = None
    sort_order: int = 0
    category_id: int | None = None


class ProductOut(FoodLabel, ORMModel):
    id: int
    name: str
    subtitle: str | None = None
    description: str | None = None
    spec: str | None = None
    origin: str | None = None
    price: float
    original_price: float | None = None
    stock: int
    image_url: str | None = None
    is_group_buy: bool
    group_buy_min_qty: int | None = None
    group_buy_note: str | None = None
    is_featured: bool
    is_active: bool
    is_purchasable: bool = True
    unavailable_note: str | None = None
    sort_order: int
    category: CategoryOut | None = None
    images: list[ProductImageOut] = []


# ---------- 新聞 ----------
class NewsIn(BaseModel):
    title: str
    summary: str | None = None
    content: str | None = None
    source: str | None = None
    source_url: str | None = None
    cover_url: str | None = None
    category: str = "news"
    published_at: datetime | None = None
    is_active: bool = True


class NewsOut(ORMModel):
    id: int
    title: str
    summary: str | None = None
    content: str | None = None
    source: str | None = None
    source_url: str | None = None
    cover_url: str | None = None
    category: str
    published_at: datetime
    is_active: bool


# ---------- 故事 ----------
class StoryIn(BaseModel):
    title: str
    subtitle: str | None = None
    content: str | None = None
    cover_url: str | None = None
    sort_order: int = 0
    is_active: bool = True


class StoryOut(ORMModel):
    id: int
    title: str
    subtitle: str | None = None
    content: str | None = None
    cover_url: str | None = None
    sort_order: int
    is_active: bool


# ---------- 訂單 ----------
class OrderItemIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1)


class OrderCreate(BaseModel):
    receiver_name: str = Field(min_length=1, max_length=60)
    receiver_phone: str = Field(min_length=1, max_length=30)
    receiver_email: str | None = None
    note: str | None = Field(default=None, max_length=400)
    items: list[OrderItemIn]

    shipping_method: ShippingMethod = ShippingMethod.cvs_unimart_c2c
    payment_method: PaymentMethod = PaymentMethod.credit

    # 超商取貨：由綠界電子地圖回傳
    cvs_store_id: str | None = None
    cvs_store_name: str | None = None
    cvs_address: str | None = None
    cvs_telephone: str | None = None
    cvs_outside: str | None = None
    # 選門市時綠界回傳的超商類型。後端會拿它跟送貨方式交叉檢查 ——
    # 門市代號綁定超商，7-11 的店號拿去寄萊爾富會出事
    cvs_sub_type: str | None = None

    # 宅配
    receiver_address: str | None = None
    receiver_zipcode: str | None = None
    temperature: str = "0001"
    specification: str = "0001"

    # 折價券代碼（選填）
    coupon_code: str | None = None


class OrderItemOut(ORMModel):
    id: int
    product_id: int | None = None
    product_name: str
    unit_price: float
    quantity: int


class OrderOut(ORMModel):
    id: int
    order_no: str
    # 訂單頁的存取碼。只有能看到這筆訂單的人才拿得到，
    # 前端會把它接在訂單頁與付款連結後面，訪客才回得去自己的訂單。
    access_token: str | None = None
    receiver_name: str
    receiver_phone: str
    receiver_address: str | None = None
    receiver_zipcode: str | None = None
    note: str | None = None
    subtotal: float = 0
    member_discount: float = 0
    coupon_code: str | None = None
    coupon_discount: float = 0
    shipping_fee: float = 0
    total_amount: float
    status: OrderStatus
    created_at: datetime
    items: list[OrderItemOut] = []

    # 送貨
    shipping_method: ShippingMethod
    shipping_method_label: str | None = None
    cvs_store_id: str | None = None
    cvs_store_name: str | None = None
    cvs_address: str | None = None
    cvs_telephone: str | None = None
    temperature: str | None = None

    # 付款
    payment_method: PaymentMethod
    payment_method_label: str | None = None
    payment_status: PaymentStatus
    is_collection: bool = False
    ecpay_trade_no: str | None = None
    payment_no: str | None = None
    payment_bank_code: str | None = None
    payment_expire_date: str | None = None
    paid_at: datetime | None = None
    payment_message: str | None = None
    payment_attempts: int = 0
    cancel_reason: str | None = None
    # 由後端算出來的（不是資料庫欄位），見 orders._decorate。
    # 前端不要自己拼這些條件，兩邊會不一致。
    payment_deadline: datetime | None = None
    can_retry_payment: bool = False
    can_cancel: bool = False

    # 物流
    logistics_status: LogisticsStatus
    allpay_logistics_id: str | None = None
    cvs_payment_no: str | None = None
    cvs_validation_no: str | None = None
    booking_note: str | None = None
    logistics_message: str | None = None


class OrderCreated(BaseModel):
    """建立訂單後回給前端的結果。"""
    order: OrderOut
    # 需要線上付款時，前端把瀏覽器導到這個網址（會自動 POST 到綠界付款頁）
    payment_url: str | None = None


class ShippingOption(BaseModel):
    value: str
    label: str
    kind: str            # cvs 超商取貨 / home 宅配
    fee: float
    supports_cod: bool
    supports_temperature: bool
    note: str | None = None
    is_cheapest: bool = False   # 前端用來標「最省運費」
    # 這個送貨方式現在完全不能選（例如只開放貨到付款、但它不支援貨到付款）。
    # 留一個「無解的組合」給前端，會讓自動修正的邏輯來回打架。
    disabled: bool = False
    disabled_reason: str | None = None


class PaymentOption(BaseModel):
    value: str
    label: str
    note: str | None = None
    # 金流還在審核但物流已正式時，線上付款要停用 ——
    # 不然客人會被帶到測試付款頁，刷了也收不到錢
    disabled: bool = False
    disabled_reason: str | None = None


class CheckoutOptions(BaseModel):
    shipping: list[ShippingOption]
    payment: list[PaymentOption]
    free_shipping_threshold: float
    cod_fee: float
    ecpay_env: str
    # 金流與物流是分開審核的，狀態要分開回報。
    # 前台用 payment_production 決定要不要顯示測試卡號提示，
    # 後台用整包判斷現在能不能開賣、能用哪些付款方式。
    # 大部分是布林（can_sell_online…），但 warnings 是一串說明文字，
    # 所以不能鎖成 dict[str, bool]
    ecpay_status: dict[str, object] = {}
    backend_base_url: str


class ShippingQuoteIn(BaseModel):
    subtotal: float
    shipping_method: ShippingMethod
    payment_method: PaymentMethod
    temperature: str = "0001"
    coupon_code: str | None = None


class ShippingQuoteOut(BaseModel):
    subtotal: float
    member_discount: float = 0
    member_discount_percent: float = 0
    member_tier_name: str | None = None
    coupon_code: str | None = None
    coupon_discount: float = 0
    coupon_error: str | None = None
    shipping_fee: float
    cod_fee: float
    total: float
    free_shipping_threshold: float
    is_free_shipping: bool


# ---------- 會員等級與折價券 ----------
class MemberTierIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    min_spent: float = 0
    discount_percent: float = Field(default=0, ge=0, le=100)
    note: str | None = None
    sort_order: int = 0
    is_active: bool = True


class MemberTierOut(ORMModel):
    id: int
    name: str
    min_spent: float
    discount_percent: float
    note: str | None = None
    sort_order: int
    is_active: bool


class CouponRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    trigger: CouponTrigger = CouponTrigger.total_spent
    threshold: float = 0
    kind: CouponKind = CouponKind.fixed
    value: float = 0
    min_order_amount: float = 0
    max_discount: float | None = None
    valid_days: int = 90
    is_active: bool = True
    sort_order: int = 0


class CouponRuleOut(ORMModel):
    id: int
    name: str
    trigger: CouponTrigger
    threshold: float
    kind: CouponKind
    value: float
    min_order_amount: float
    max_discount: float | None = None
    valid_days: int
    is_active: bool
    sort_order: int


class CouponOut(ORMModel):
    id: int
    code: str
    name: str
    kind: CouponKind
    value: float
    min_order_amount: float
    max_discount: float | None = None
    expires_at: datetime | None = None
    used_at: datetime | None = None
    used_order_no: str | None = None
    created_at: datetime | None = None
    label: str | None = None       # 給前端顯示的優惠說明
    is_usable: bool = True


class MembershipOut(BaseModel):
    """會員中心用的完整會籍資訊。"""
    total_spent: float
    tier: MemberTierOut | None = None
    next_tier: MemberTierOut | None = None
    amount_to_next_tier: float = 0
    tiers: list[MemberTierOut] = []
    coupons: list[CouponOut] = []
    used_coupons: list[CouponOut] = []


class MemberSummaryOut(ORMModel):
    """後台會員列表用。"""
    id: int
    email: EmailStr
    name: str
    phone: str | None = None
    role: UserRole
    email_verified: bool
    total_spent: float
    created_at: datetime | None = None
    tier_name: str | None = None
    order_count: int = 0
    coupon_count: int = 0


class OrderStatusUpdate(BaseModel):
    status: OrderStatus
    # 改成「已出貨／已完成」時，要不要同時把付款狀態標成已收款。
    # 預設 False —— 出貨與收款是兩件事，系統不該替工作人員決定錢收到了沒。
    mark_paid: bool = False


class PaymentMethodUpdate(BaseModel):
    """未付款的訂單換一種付款方式再試。"""
    payment_method: PaymentMethod


# ---------- 上傳 / 設定 ----------
class UploadOut(BaseModel):
    url: str
    filename: str


class SettingsIn(BaseModel):
    values: dict[str, str]
