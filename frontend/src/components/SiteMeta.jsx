import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { api, mediaUrl } from '../api/client'
import { useSettings } from '../context/SettingsContext'

/**
 * 依後台「網站設定」動態更新分頁標題、描述、社群預覽與結構化資料。
 *
 * 這些東西寫死在 index.html 裡的話，改店名就得改程式碼再重新部署。
 *
 * **限制講在前面：** 整站是前端渲染，所以爬蟲第一次抓到的是還沒執行 JS 的 HTML。
 * Google 會執行 JS，所以這裡設的東西它讀得到；
 * 但 LINE、Facebook 的預覽卡片**不會執行 JS**，
 * 它們只看得到 index.html 裡的靜態標籤。
 * 所以 index.html 裡也要有一份合理的預設值 —— 那才是分享時真正會顯示的內容。
 * 要讓每個商品都有自己的分享預覽，需要 SSR 或預渲染，那是另一件事。
 */

/** 各頁面的標題與描述。key 是路徑的比對規則。 */
const PAGE_META = [
  { match: /^\/products\/\d+/, title: null },   // 商品頁由 ProductDetail 自己設定
  { match: /^\/products/, title: '蜂蜜商品', desc: '基隆七堵自家蜂場，等蜜熟成才採收的各式蜂蜜。' },
  { match: /^\/group-buy/, title: '團購專區', desc: '公司行號、社區揪團、幼兒園採購，可分裝與客製標籤。' },
  { match: /^\/news/, title: '新聞報導', desc: '媒體報導與最新消息。' },
  { match: /^\/story/, title: '品牌故事', desc: '關於基隆的雨、山裡的花，以及一瓶蜜為什麼要多等一次花期。' },
  { match: /^\/contact/, title: '聯絡我們', desc: '訂購、團購洽談，歡迎透過電話、LINE 或 Email 聯絡。' },
  { match: /^\/privacy/, title: '隱私權政策' },
  { match: /^\/terms/, title: '服務條款' },
  { match: /^\/refund/, title: '退換貨政策', desc: '食品類商品的退換貨規則與例外情形。' },
]

/** 設定一個 meta 標籤。給其他頁面（例如商品頁）覆寫用。 */
export function setMetaTag(attr, key, content) {
  setMeta(attr, key, content)
}

function setMeta(attr, key, content) {
  let tag = document.querySelector(`meta[${attr}="${key}"]`)
  if (!content) {
    tag?.remove()
    return
  }
  if (!tag) {
    tag = document.createElement('meta')
    tag.setAttribute(attr, key)
    document.head.appendChild(tag)
  }
  tag.setAttribute('content', content)
}

function setLink(rel, href) {
  let tag = document.querySelector(`link[rel="${rel}"]`)
  if (!href) {
    if (rel !== 'icon') tag?.remove()
    return
  }
  if (!tag) {
    tag = document.createElement('link')
    tag.rel = rel
    document.head.appendChild(tag)
  }
  tag.href = href
}

/** 結構化資料（JSON-LD）。同一個 id 重複寫入時直接覆蓋。 */
export function setStructuredData(id, data) {
  const domId = `ld-${id}`
  let tag = document.getElementById(domId)
  if (!data) {
    tag?.remove()
    return
  }
  if (!tag) {
    tag = document.createElement('script')
    tag.type = 'application/ld+json'
    tag.id = domId
    document.head.appendChild(tag)
  }
  tag.textContent = JSON.stringify(data)
}

export default function SiteMeta() {
  const { settings, loaded } = useSettings()
  const location = useLocation()

  // LocalBusiness：你有實體蜂場地址，對「基隆蜂蜜」這種在地關鍵字很有幫助。
  // 只在首頁掛，其他頁掛了反而會讓 Google 分不清主體是誰。
  useEffect(() => {
    if (location.pathname !== '/') {
      setStructuredData('business', null)
      return
    }
    api.structuredData()
      .then((data) => setStructuredData('business', data))
      .catch(() => {})
  }, [location.pathname])

  useEffect(() => {
    if (!loaded) return   // 還沒拿到設定就先維持 index.html 的預設值

    const name = settings.shop_name || '皇龍蜂蜜'
    const slogan = settings.shop_slogan || ''
    const siteDesc = settings.hero_desc || slogan
      || '基隆七堵山區自家蜂場，等蜜在巢裡熟成才採收，不加水不加糖。'

    const page = PAGE_META.find((p) => p.match.test(location.pathname))
    // title 明確給 null 代表那一頁自己會設（例如商品頁要放商品名）
    const skip = page && page.title === null
    if (skip) return

    const title = page?.title ? `${page.title}｜${name}` : (slogan ? `${name}｜${slogan}` : name)
    const desc = page?.desc || siteDesc
    const url = window.location.origin + location.pathname

    document.title = title
    setMeta('name', 'description', desc)

    // 分享到 LINE、Facebook 時的預覽卡片
    setMeta('property', 'og:site_name', name)
    setMeta('property', 'og:title', title)
    setMeta('property', 'og:description', desc)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:url', url)
    setMeta('property', 'og:locale', 'zh_TW')
    if (settings.hero_image_url) {
      setMeta('property', 'og:image', mediaUrl(settings.hero_image_url))
    }
    // Twitter / X 用的是另一套標籤，大圖比小縮圖好看很多
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', title)
    setMeta('name', 'twitter:description', desc)

    // canonical：告訴搜尋引擎這一頁的正式網址是哪一個，
    // 避免帶了追蹤參數的網址被當成不同頁面而分散權重
    setLink('canonical', url)

    if (settings.favicon_url) {
      setLink('icon', mediaUrl(settings.favicon_url))
      document.querySelector('link[rel="icon"]')?.removeAttribute('type')
    }
  }, [settings, loaded, location.pathname])

  return null
}
