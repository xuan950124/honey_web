/**
 * Google 地圖相關的網址組裝。
 *
 * 這裡全是純字串處理，抽出來才能用 node 直接測 ——
 * 分支多到用眼睛看不完（座標／分享短網址／整段 iframe／pb 嵌入碼／純地址）。
 *
 * ## 為什麼要這麼麻煩
 *
 * 台灣門牌的「89-6號」在 Google 的資料庫裡常常查不到，
 * 它會就近對到「89號」。這件事同時影響兩個地方：
 *
 *   1. 地圖上的紅點插在隔壁
 *   2. **「規劃路線」把客人導到隔壁**  ← 這個比較嚴重
 *
 * 徹底的解法是**不要讓 Google 再猜一次**：
 *
 * | 後台欄位 | 作用 |
 * |---|---|
 * | 地圖嵌入碼 `map_embed_url` | 直接貼 Google 地圖「分享 → 嵌入地圖 → 複製 HTML」那一整段 |
 * | 地圖連結 `map_link_url` | 「分享 → 傳送連結」那個 `maps.app.goo.gl` 短網址 |
 *
 * 兩個都指向**你的商家檔案本身**，不是一段地址文字，所以沒有猜的空間。
 */

/*
  出廠預設：皇龍養蜂場的 Google 商家檔案。

  常數放這裡、**套用在 SettingsContext**（見 `withMapDefaults`）。
  這樣這一份保持是純函式庫 —— 每個分支都測得到「後台沒填時會怎麼樣」，
  不會因為預設值一直生效而讓後備邏輯變成沒人跑過的死路。
*/
export const DEFAULT_MAP_EMBED =
  'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d225.825226643344'
  + '!2d121.66599349016094!3d25.09496753542184!3m2!1i1024!2i768!4f13.1'
  + '!3m3!1m2!1s0x345d538947b28f33%3A0x1ba94c05a1f3ea18!2z55qH6b6N6aSK6JyC5aC0'
  + '!5e0!3m2!1szh-TW!2sus!4v1787242544163!5m2!1szh-TW!2sus'

export const DEFAULT_MAP_LINK = 'https://maps.app.goo.gl/wrzBQ8iPtgkoWdMs8'

/**
 * 補上出廠預設的地圖設定。後台填了就以後台為準，沒填才用預設。
 *
 * 在 SettingsContext 補而不是在每個函式裡補：
 * 「網站一部署就該指到對的地方」是一次性的資料問題，
 * 不該讓底下每個組網址的函式都得記得處理一次。
 */
export function withMapDefaults(settings = {}) {
  return {
    ...settings,
    map_embed_url: (settings.map_embed_url || '').trim() || DEFAULT_MAP_EMBED,
    map_link_url: (settings.map_link_url || '').trim() || DEFAULT_MAP_LINK,
  }
}

/** 純座標，例如「25.105821, 121.712378」。Google 地圖右鍵複製出來就是這個格式。 */
const COORD_ONLY = /^\s*(-?\d{1,3}\.\d+)\s*[,，]\s*(-?\d{1,3}\.\d+)\s*$/

/** 分享網址裡的 @緯度,經度 */
const COORD_IN_URL = /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/

/** ?q=緯度,經度 */
const COORD_IN_QUERY = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/

/**
 * 嵌入碼 `?pb=` 裡的座標。
 *
 * 那串看起來像亂碼的東西其實是有結構的，其中
 * `!2d<經度>!3d<緯度>` 就是地圖中心點 —— **注意是先經度再緯度**，
 * 跟一般寫法相反，寫錯的話點會跑到地球另一邊。
 */
const COORD_IN_PB = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/

/** 已經可以直接放進 iframe 的網址。 */
const EMBEDDABLE = /\/maps\/embed|[?&]output=embed/i

/** 從可能是「整段 iframe HTML」的字串裡取出網址。 */
function srcOf(raw) {
  const iframeSrc = raw.match(/src=["']([^"']+)["']/i)
  return iframeSrc ? iframeSrc[1] : raw
}

/**
 * 取出後台設定的精確座標。沒填或看不懂就回 null。
 * 回傳的是 "緯度,經度" 字串 —— Google 的網址參數就是這個格式，不用再拼一次。
 */
export function mapPoint(settings = {}) {
  const raw = (settings.map_embed_url || '').trim()
  if (!raw) return null

  const direct = raw.match(COORD_ONLY)
  if (direct) return `${direct[1]},${direct[2]}`

  const url = srcOf(raw)

  const inUrl = url.match(COORD_IN_URL)
  if (inUrl) return `${inUrl[1]},${inUrl[2]}`

  const inQuery = url.match(COORD_IN_QUERY)
  if (inQuery) return `${inQuery[1]},${inQuery[2]}`

  // pb 嵌入碼：!2d 是經度、!3d 是緯度，要反過來組
  const inPb = url.match(COORD_IN_PB)
  if (inPb) return `${inPb[2]},${inPb[1]}`

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
 * 「在 Google 地圖開啟」的網址。地址文字與地圖角落的按鈕都用它。
 *
 * 優先順序是刻意的：
 *
 * 1. **後台填的分享連結**（`maps.app.goo.gl/...`）——
 *    這是直接指向商家檔案的短網址，開起來一定是對的那個點
 * 2. 座標
 * 3. 地址文字（最後手段，Google 會重新猜一次）
 */
export function placeUrl(settings = {}) {
  const link = (settings.map_link_url || '').trim()
  if (/^https?:\/\//i.test(link)) return link

  const point = mapPoint(settings)
  if (point) return `https://www.google.com/maps/search/?api=1&query=${point}`

  const query = addressQuery(settings) || (settings.contact_address || '').trim()
  if (!query) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * 「規劃路線」的網址。
 *
 * **有分享連結就用分享連結。** 它指向商家檔案本身，開啟後按一下就能導航，
 * 而且百分之百是對的點。自己拼 `dir/?api=1&destination=地址` 的話，
 * Google 會重新猜一次，客人就被導到 89 號而不是 89-6 號 ——
 * 地圖上的點對了、導航卻錯了，比兩邊都錯更容易讓人白跑一趟。
 */
export function directionsUrl(settings = {}) {
  const link = (settings.map_link_url || '').trim()
  if (/^https?:\/\//i.test(link)) return link

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

  if (!raw) return byAddress

  const url = srcOf(raw)

  /*
    已經是官方嵌入碼的話**原封不動用它**，不要自作聰明拆成座標重組。

    Google 的「分享 → 嵌入地圖」給的是指向商家檔案的網址，
    地圖上會顯示店名、評分那張小卡；改成 `?q=座標` 之後只剩一根光禿禿的針，
    店名不見了 —— 那是把使用者刻意挑好的東西換掉。
  */
  if (EMBEDDABLE.test(url)) return url

  // 沒有嵌入碼時，座標最精準
  const point = mapPoint(settings)
  if (point) return `https://maps.google.com/maps?q=${point}&z=18&output=embed`

  const place = url.match(/\/place\/([^/@?#]+)/)
  if (place) return `https://maps.google.com/maps?q=${place[1]}&z=17&output=embed`

  const q = url.match(/[?&]q=([^&]+)/)
  if (q) return `https://maps.google.com/maps?q=${q[1]}&z=17&output=embed`

  // 短網址（maps.app.goo.gl）在瀏覽器端無法展開，改用地址
  if (byAddress) return byAddress

  // 不是網址而是一段地址文字
  if (!/^https?:\/\//i.test(url)) {
    return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&z=17&output=embed`
  }
  return ''
}

/**
 * 地圖與導航是不是都指到確定的點（而不是靠 Google 猜地址）。
 *
 * 有分享連結或座標其中之一就算 —— 兩者都是明確的目標，
 * 沒有「89-6 號被對到 89 號」的空間。
 */
export function hasExactLocation(settings = {}) {
  return Boolean((settings.map_link_url || '').trim() || mapPoint(settings))
}
