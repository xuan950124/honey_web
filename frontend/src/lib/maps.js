/**
 * Google 地圖相關的網址組裝。
 *
 * 這裡全是純字串處理，抽出來才能用 node 直接測 ——
 * 分支多到用眼睛看不完（座標／分享網址／整段 iframe／純地址）。
 *
 * ## 為什麼要這麼麻煩
 *
 * 台灣門牌的「89-6號」在 Google 的資料庫裡常常查不到，
 * 它會就近對到「89號」。這件事同時影響兩個地方：
 *
 *   1. 地圖上的紅點插在隔壁
 *   2. **「規劃路線」把客人導到隔壁**  ← 這個比較嚴重
 *
 * 只要後台填了座標，兩個地方都改用座標，Google 就沒有猜的空間。
 */

/** 純座標，例如「25.105821, 121.712378」。Google 地圖右鍵複製出來就是這個格式。 */
const COORD_ONLY = /^\s*(-?\d{1,3}\.\d+)\s*[,，]\s*(-?\d{1,3}\.\d+)\s*$/

/** 分享網址裡的 @緯度,經度 */
const COORD_IN_URL = /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/

/** ?q=緯度,經度 */
const COORD_IN_QUERY = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/

/**
 * 取出後台設定的精確座標。沒填或看不懂就回 null。
 * 回傳的是 "緯度,經度" 字串 —— Google 的網址參數就是這個格式，不用再拼一次。
 */
export function mapPoint(settings = {}) {
  const raw = (settings.map_embed_url || '').trim()
  if (!raw) return null

  const direct = raw.match(COORD_ONLY)
  if (direct) return `${direct[1]},${direct[2]}`

  // 整段 iframe 貼上來時先把 src 抓出來
  const iframeSrc = raw.match(/src=["']([^"']+)["']/i)
  const url = iframeSrc ? iframeSrc[1] : raw

  const inUrl = url.match(COORD_IN_URL)
  if (inUrl) return `${inUrl[1]},${inUrl[2]}`

  const inQuery = url.match(COORD_IN_QUERY)
  if (inQuery) return `${inQuery[1]},${inQuery[2]}`

  return null
}

/**
 * 地址的查詢字串。
 * 「89-6號」轉成「89之6號」—— Google 台灣對「之」的辨識率比「-」高，
 * 再帶上店名，有 Google 商家檔案時會優先對到那個點。
 */
export function addressQuery(settings = {}) {
  const address = (settings.contact_address || '').trim()
  if (!address) return ''
  const zhi = address.replace(/(\d+)-(\d+)號/g, '$1之$2號')
  const name = (settings.shop_name || '').trim()
  return [name, zhi].filter(Boolean).join(' ')
}

/**
 * 「規劃路線」的網址。
 *
 * **有座標就一定要用座標。** 用地址的話 Google 會重新猜一次，
 * 客人就被導到 89 號而不是 89-6 號 —— 地圖上的點對了、導航卻錯了，
 * 比兩邊都錯更容易讓人白跑一趟。
 */
export function directionsUrl(settings = {}) {
  const point = mapPoint(settings)
  const destination = point || addressQuery(settings) || (settings.contact_address || '')
  if (!destination) return ''
  return 'https://www.google.com/maps/dir/?api=1&destination='
    + encodeURIComponent(destination)
}

/**
 * 可嵌入的地圖網址。
 *
 * Google 對一般的地圖網址（例如 /maps/place/...）設了 X-Frame-Options，
 * 直接放進 iframe 會被拒絕連線，只有 /maps/embed 或加了 output=embed 的網址可以。
 */
export function buildMapSrc(settings = {}) {
  const raw = (settings.map_embed_url || '').trim()
  const query = addressQuery(settings)
  const byAddress = query
    ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`
    : ''

  if (raw) {
    // 座標最精準，優先處理
    const point = mapPoint(settings)
    if (point) {
      return `https://maps.google.com/maps?q=${point}&z=18&output=embed`
    }

    const iframeSrc = raw.match(/src=["']([^"']+)["']/i)
    const url = iframeSrc ? iframeSrc[1] : raw

    // 已經是可嵌入的形式
    if (/\/maps\/embed/i.test(url) || /[?&]output=embed/i.test(url)) return url

    const place = url.match(/\/place\/([^/@?#]+)/)
    if (place) {
      return `https://maps.google.com/maps?q=${place[1]}&z=17&output=embed`
    }
    const q = url.match(/[?&]q=([^&]+)/)
    if (q) {
      return `https://maps.google.com/maps?q=${q[1]}&z=17&output=embed`
    }
    // 短網址（maps.app.goo.gl）在瀏覽器端無法展開，改用地址
    if (byAddress) return byAddress
    // 不是網址而是一段地址文字
    if (!/^https?:\/\//i.test(url)) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&z=17&output=embed`
    }
    return ''
  }

  return byAddress
}
