// 與 FastAPI 後端溝通的薄封裝。
//
// 本機開發：VITE_API_BASE 留空，走 vite.config.js 的 proxy 轉發到 8000 埠。
// 正式部署：前後端是不同網域，打包時要設定
//     VITE_API_BASE=https://api.你的網域.com
// Vite 會在「建置階段」把這個值寫死進去，所以改了必須重新部署才會生效。
// 優先用「執行階段」的設定（public/config.js，部署時由容器覆寫），
// 找不到才退回建置時寫入的值。這樣改後端網址不必重新建置前端。
const runtimeApiBase =
  typeof window !== 'undefined' && window.__APP_CONFIG__ ? window.__APP_CONFIG__.apiBase : ''
const API_BASE = (runtimeApiBase || import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

/** 後端的完整網址。給 window.open、表單 action 這類需要絕對路徑的地方用。 */
export const apiUrl = (path = '') => `${API_BASE}${path}`

/** 訂單的付款連結。要帶存取碼，後端才會認。 */
export const checkoutUrl = (order) =>
  apiUrl(`/api/payments/${order.order_no}/checkout`)
  + (order.access_token ? `?t=${encodeURIComponent(order.access_token)}` : '')

/** 訂單頁的網址（含存取碼）。 */
export const orderUrl = (order) =>
  `/order/${order.order_no}`
  + (order.access_token ? `?t=${encodeURIComponent(order.access_token)}` : '')

/** 後端上傳的圖片網址。資料庫存的是 /uploads/xxx.jpg 這種相對路徑。 */
export const mediaUrl = (path) => {
  if (!path) return path
  if (/^(https?:|data:|blob:)/i.test(path)) return path   // 已經是完整網址
  if (path.startsWith('/uploads')) return `${API_BASE}${path}`
  return path                                              // /images/xxx 放在前端自己的 public
}

const TOKEN_KEY = 'honey_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (cause) {
    // 連線失敗（斷網、DNS、伺服器沒回應、或後端整個沒起來）。
    //
    // 這裡也包含一種很容易誤判的情況：後端掛掉時，反向代理會回一個
    // 不帶 CORS 標頭的錯誤頁，瀏覽器就報「已被 CORS 政策封鎖」。
    // 看起來像跨網域設定壞了，其實是後端根本沒在跑 ——
    // 所以訊息裡直接給出健康檢查網址，一點就知道是哪一層的問題。
    const err = new Error(
      API_BASE
        ? `無法連線到伺服器。可能是後端服務沒有啟動，或資料庫連不上。`
          + `　可以打開 ${API_BASE}/api/health 確認：有回應代表程式活著，`
          + `再看 ${API_BASE}/api/health/db 確認資料庫。`
        : '無法連線到伺服器，請稍後再試',
    )
    err.isNetworkError = true
    err.cause = cause
    throw err
  }

  if (res.status === 204) return null

  // 後端一律回 JSON。如果收到 HTML，多半是請求被靜態伺服器或反向代理接走了，
  // 這時要明確報錯，不然前端會拿到 null 而在很後面才爆出看不懂的錯誤。
  const contentType = res.headers.get('content-type') || ''
  let data = null
  try {
    data = await res.json()
  } catch {
    if (!contentType.includes('json')) {
      throw new Error(
        `伺服器回傳的不是 JSON（${res.status} ${contentType || '未知格式'}）。` +
          '請確認 VITE_API_BASE 是否指向正確的後端網址。',
      )
    }
    data = null
  }

  if (!res.ok) {
    const message =
      typeof data?.detail === 'string'
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d.msg).join('、')
          : `發生錯誤（${res.status}）`
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  return data
}

export const api = {
  // 會員
  register: (payload) => request('/api/auth/register', { method: 'POST', body: payload }),
  login: (payload) => request('/api/auth/login', { method: 'POST', body: payload }),
  me: () => request('/api/auth/me'),
  updateMe: (payload) => request('/api/auth/me', { method: 'PATCH', body: payload }),

  // 信箱驗證與密碼
  resendVerification: () =>
    request('/api/auth/verify-email/resend', { method: 'POST' }),
  confirmVerification: (token) =>
    request('/api/auth/verify-email/confirm', { method: 'POST', body: { token } }),
  forgotPassword: (email) =>
    request('/api/auth/password/forgot', { method: 'POST', body: { email } }),
  resetPassword: (token, password) =>
    request('/api/auth/password/reset', { method: 'POST', body: { token, password } }),
  changePassword: (currentPassword, newPassword) =>
    request('/api/auth/password/change', {
      method: 'POST',
      body: { current_password: currentPassword, new_password: newPassword },
    }),

  // 商品
  listProducts: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    return request(`/api/products${qs ? `?${qs}` : ''}`)
  },
  getProduct: (id) => request(`/api/products/${id}`),
  createProduct: (payload) => request('/api/products', { method: 'POST', body: payload }),
  updateProduct: (id, payload) => request(`/api/products/${id}`, { method: 'PUT', body: payload }),
  deleteProduct: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
  addProductImage: (id, imageUrl, caption = '') =>
    request(
      `/api/products/${id}/images?image_url=${encodeURIComponent(imageUrl)}&caption=${encodeURIComponent(caption)}`,
      { method: 'POST' },
    ),
  deleteProductImage: (imageId) => request(`/api/product-images/${imageId}`, { method: 'DELETE' }),

  // 分類
  listCategories: () => request('/api/categories'),
  createCategory: (payload) => request('/api/categories', { method: 'POST', body: payload }),
  deleteCategory: (id) => request(`/api/categories/${id}`, { method: 'DELETE' }),

  // 新聞
  listNews: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString()
    return request(`/api/news${qs ? `?${qs}` : ''}`)
  },
  getNews: (id) => request(`/api/news/${id}`),
  createNews: (payload) => request('/api/news', { method: 'POST', body: payload }),
  updateNews: (id, payload) => request(`/api/news/${id}`, { method: 'PUT', body: payload }),
  deleteNews: (id) => request(`/api/news/${id}`, { method: 'DELETE' }),

  // 故事
  listStories: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/api/stories${qs ? `?${qs}` : ''}`)
  },
  createStory: (payload) => request('/api/stories', { method: 'POST', body: payload }),
  updateStory: (id, payload) => request(`/api/stories/${id}`, { method: 'PUT', body: payload }),
  deleteStory: (id) => request(`/api/stories/${id}`, { method: 'DELETE' }),

  // 訂單
  createOrder: (payload) => request('/api/orders', { method: 'POST', body: payload }),
  myOrders: () => request('/api/orders/my'),
  allOrders: () => request('/api/orders'),
  // token 是訂單的存取碼。訂單編號是時間戳猜得到，所以訪客要憑這組碼才看得到自己的訂單。
  getOrderByNo: (orderNo, token) =>
    request(`/api/orders/by-no/${orderNo}${token ? `?t=${encodeURIComponent(token)}` : ''}`),
  updateOrderStatus: (id, status) =>
    request(`/api/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  // 未付款／付款失敗的處理
  changePaymentMethod: (orderNo, paymentMethod, token) =>
    request(
      `/api/orders/by-no/${orderNo}/payment-method${token ? `?t=${encodeURIComponent(token)}` : ''}`,
      { method: 'PATCH', body: { payment_method: paymentMethod } },
    ),
  cancelOrder: (orderNo) =>
    request(`/api/orders/by-no/${orderNo}/cancel`, { method: 'POST' }),
  expireUnpaid: () => request('/api/orders/expire-unpaid', { method: 'POST' }),

  // 會員等級與折價券
  membership: () => request('/api/membership/me'),
  publicTiers: () => request('/api/membership/tiers'),
  adminTiers: () => request('/api/admin/tiers'),
  createTier: (payload) => request('/api/admin/tiers', { method: 'POST', body: payload }),
  updateTier: (id, payload) => request(`/api/admin/tiers/${id}`, { method: 'PUT', body: payload }),
  deleteTier: (id) => request(`/api/admin/tiers/${id}`, { method: 'DELETE' }),
  adminCouponRules: () => request('/api/admin/coupon-rules'),
  createCouponRule: (payload) => request('/api/admin/coupon-rules', { method: 'POST', body: payload }),
  updateCouponRule: (id, payload) =>
    request(`/api/admin/coupon-rules/${id}`, { method: 'PUT', body: payload }),
  deleteCouponRule: (id) => request(`/api/admin/coupon-rules/${id}`, { method: 'DELETE' }),
  adminMembers: (keyword) =>
    request(`/api/admin/members${keyword ? `?keyword=${encodeURIComponent(keyword)}` : ''}`),
  adminCoupons: (onlyUnused) =>
    request(`/api/admin/coupons${onlyUnused ? '?only_unused=true' : ''}`),

  // 結帳（送貨／付款方式與運費）
  checkoutOptions: () => request('/api/orders/checkout-options'),
  quote: (payload) => request('/api/orders/quote', { method: 'POST', body: payload }),

  // 物流（綠界）
  createLogistics: (orderId) =>
    request(`/api/logistics/orders/${orderId}/create`, { method: 'POST' }),

  // 金流（綠界）
  syncPayment: (orderNo) => request(`/api/payments/${orderNo}/sync`, { method: 'POST' }),
  markPaid: (orderNo) => request(`/api/payments/${orderNo}/mark-paid`, { method: 'POST' }),

  // 設定
  getSettings: () => request('/api/settings'),
  updateSettings: (values) => request('/api/settings', { method: 'PUT', body: { values } }),

  // 政策條款（分開的端點：這幾份文字很長，不該讓每一頁都載）
  policies: () => request('/api/policies'),
  structuredData: () => request('/api/seo/structured-data'),

  // 上傳
  uploadImage: (file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request('/api/uploads', { method: 'POST', body: fd, isForm: true })
  },
}

export const formatPrice = (n) => Number(n || 0).toLocaleString('zh-TW')

export const formatDate = (value) => {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

export const PAYMENT_STATUS_TEXT = {
  unpaid: '未付款',
  pending: '待繳費',
  paid: '已付款',
  failed: '付款失敗',
  refunded: '已退款',
}

export const LOGISTICS_STATUS_TEXT = {
  none: '未建單',
  created: '已建單',
  shipped: '已寄件',
  arrived: '已到店',
  picked: '已取貨',
  returned: '退貨中',
  failed: '建單失敗',
}

export const TEMPERATURE_TEXT = {
  '0001': '常溫',
  '0002': '冷藏',
  '0003': '冷凍',
}

export const COUPON_KIND_TEXT = {
  fixed: '折固定金額',
  percent: '百分比折扣',
  free_shipping: '免運',
}

export const COUPON_TRIGGER_TEXT = {
  register: '新會員註冊禮',
  total_spent: '累積消費達標',
}

export const ORDER_STATUS_TEXT = {
  pending: '待處理',
  paid: '已付款',
  shipped: '已出貨',
  completed: '已完成',
  cancelled: '已取消',
}
