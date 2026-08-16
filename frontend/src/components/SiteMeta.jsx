import { useEffect } from 'react'
import { mediaUrl } from '../api/client'
import { useSettings } from '../context/SettingsContext'

/**
 * 依後台「網站設定」動態更新瀏覽器分頁的標題、描述與 icon。
 *
 * 這些東西寫在 index.html 裡是靜態的，改店名就得改程式碼再重新部署。
 * 改成載入後由設定覆寫，店家自己在後台改完就會生效。
 */
export default function SiteMeta() {
  const { settings, loaded } = useSettings()

  useEffect(() => {
    if (!loaded) return   // 還沒拿到設定就先維持 index.html 的預設值
    const name = settings.shop_name || '皇龍蜂蜜'
    const slogan = settings.shop_slogan || ''

    document.title = slogan ? `${name}｜${slogan}` : name

    const setMeta = (attr, key, content) => {
      if (!content) return
      let tag = document.querySelector(`meta[${attr}="${key}"]`)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute(attr, key)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }

    setMeta('name', 'description', slogan)
    // 分享到 LINE、Facebook 時會用到的預覽資訊
    setMeta('property', 'og:title', name)
    setMeta('property', 'og:description', slogan)
    setMeta('property', 'og:type', 'website')
    if (settings.hero_image_url) {
      setMeta('property', 'og:image', mediaUrl(settings.hero_image_url))
    }

    // 後台有上傳自訂 icon 就換掉預設的
    if (settings.favicon_url) {
      let link = document.querySelector('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = mediaUrl(settings.favicon_url)
      link.removeAttribute('type')
    }
  }, [settings, loaded])

  return null
}
