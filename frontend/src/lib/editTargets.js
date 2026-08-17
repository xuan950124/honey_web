/**
 * 編輯模式的「每頁預設編輯目標」。
 *
 * 抽成獨立檔案的原因：這裡全是純邏輯（路徑比對），
 * 分出來就能用 node 直接測，不用跑瀏覽器。
 * 順序有意義 —— 由細到粗，先比對到的贏。
 */
export const PAGE_TARGETS = [
  {
    match: /^\/$/,
    label: '首頁',
    to: '/admin/settings',
    hint: '首頁大標與說明在「網站設定 → 首頁主視覺文案」。'
      + '商品區塊請到「商品管理」把商品勾選「首頁精選」。',
  },
  {
    match: /^\/products\/\d+/,
    label: '商品內容',
    to: '/admin/products',
    hint: '在商品管理裡點這個商品的「編輯」。',
  },
  { match: /^\/products\/?$/, label: '商品列表', to: '/admin/products' },
  {
    match: /^\/group-buy/,
    label: '團購商品',
    to: '/admin/products',
    hint: '把商品勾選「團購商品」就會出現在這一頁。',
  },
  { match: /^\/news/, label: '新聞報導', to: '/admin/news' },
  { match: /^\/story/, label: '品牌故事', to: '/admin/stories' },
  { match: /^\/contact/, label: '聯絡資訊', to: '/admin/settings' },
  {
    match: /^\/cart/,
    label: '運費與付款設定',
    to: '/admin/settings',
    hint: '運費在「網站設定 → 運費設定」，每一格下面都寫了綠界的實際成本。',
  },
  { match: /^\/order/, label: '訂單', to: '/admin/orders' },
  { match: /^\/member/, label: '會員等級與折價券', to: '/admin/membership' },
]

/** 這一頁的內容大致上在後台哪裡改。找不到就回 null。 */
export function pageTarget(pathname = '') {
  return PAGE_TARGETS.find((t) => t.match.test(pathname)) || null
}

/**
 * 編輯模式下「照原樣運作、不要攔」的東西。
 *
 * 導覽列是最重要的一項：連結若被攔住，打開編輯模式之後就走不到別的頁面，
 * 得先關掉、換頁、再打開，那這個功能就沒人想用了。
 */
export const SKIP_SELECTOR = [
  '.edit-fab', '.edit-bar', '.edit-pop', '.edit-pop__backdrop',
  '.preview-fab', '.preview-overlay',
  '.nav', '.drawer', '.hamburger', '.breadcrumb',
  '[data-edit-skip]',
].join(', ')

/**
 * 把一個元素標成「可編輯區塊」。
 *
 * 刻意回傳一組 data-* 屬性而不是包一層元件 ——
 * 包元件會多出一個 DOM 節點，在 grid / flex 版面裡很容易把排版弄壞。
 * 用屬性的話，關掉編輯模式時一般訪客那邊完全沒有任何變化。
 *
 *   <span {...editable('品牌標語', '/admin/settings', 'shop_slogan')}>…</span>
 *
 * @param label 給人看的名稱，例如「品牌標語」
 * @param to    後台的路徑，例如 /admin/settings
 * @param focus 後台頁面上要捲到並高亮的欄位 key（選填）
 * @param hint  額外說明，例如「這張圖建議 1200×900」（選填）
 */
export function editable(label, to, focus, hint) {
  return {
    'data-edit': to,
    'data-edit-label': label,
    ...(focus ? { 'data-edit-focus': focus } : null),
    ...(hint ? { 'data-edit-hint': hint } : null),
  }
}

/** 後台連結（含要高亮的欄位）。 */
export function adminLink(to, focus) {
  return focus ? `${to}?focus=${encodeURIComponent(focus)}` : to
}
