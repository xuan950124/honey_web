// 與 FastAPI 後端溝通的薄封裝。開發時由 vite.config.js 的 proxy 轉發到 8000 埠。
const TOKEN_KEY = 'honey_token'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(path, {
    method,
    headers,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
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
  getOrderByNo: (orderNo) => request(`/api/orders/by-no/${orderNo}`),
  updateOrderStatus: (id, status) =>
    request(`/api/orders/${id}/status`, { method: 'PATCH', body: { status } }),

  // 結帳（送貨／付款方式與運費）
  checkoutOptions: () => request('/api/orders/checkout-options'),
  quote: (payload) => request('/api/orders/quote', { method: 'POST', body: payload }),

  // 物流（綠界）
  createLogistics: (orderId) =>
    request(`/api/logistics/orders/${orderId}/create`, { method: 'POST' }),

  // 金流（綠界）
  syncPayment: (orderNo) => request(`/api/payments/${orderNo}/sync`, { method: 'POST' }),

  // 設定
  getSettings: () => request('/api/settings'),
  updateSettings: (values) => request('/api/settings', { method: 'PUT', body: { values } }),

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

export const ORDER_STATUS_TEXT = {
  pending: '待處理',
  paid: '已付款',
  shipped: '已出貨',
  completed: '已完成',
  cancelled: '已取消',
}
