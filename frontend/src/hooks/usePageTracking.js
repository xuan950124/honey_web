import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

/**
 * 記錄瀏覽人數。
 *
 * ## 誰不會被算進去
 *
 * 1. **工作人員**（登入狀態）—— 你每天開後台看十次，那些數字會蓋掉真實客人的樣子
 * 2. **這台裝置關掉統計**（見下方 OPT_OUT_KEY）—— 沒登入時逛自己的網站也不算
 * 3. **手機版預覽的 iframe**（?preview=1）—— 那是同一個人在看同一頁
 * 4. 後台、購物車、訂單頁 —— 那不是「客人在逛」（後端也會擋一次）
 *
 * 前端擋 + 後端也擋，兩層。只靠前端的話改一行 JS 就繞過去；
 * 只靠後端的話前端還是白白送出一堆請求。
 *
 * ## 為什麼失敗完全不管
 *
 * 統計是「有更好，沒有也不影響任何人買東西」的功能。
 * 送不出去就算了，不該在訪客的主控台留下紅字，更不該影響畫面。
 */

export const OPT_OUT_KEY = 'honey_no_analytics'

/** 這台裝置要不要計入瀏覽統計。 */
export const isOptedOut = () => {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1'
  } catch {
    return false   // 無痕模式讀不到 localStorage，當作要計入
  }
}

export const setOptedOut = (value) => {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, '1')
    else localStorage.removeItem(OPT_OUT_KEY)
  } catch {
    // 存不起來也沒關係，就是這次不生效
  }
}

export default function usePageTracking() {
  const location = useLocation()
  const { isStaff } = useAuth()

  useEffect(() => {
    if (isStaff || isOptedOut()) return
    // 手機版預覽是把自己的網站塞進 iframe，算進去等於一次瀏覽變兩次
    if (new URLSearchParams(location.search).get('preview') === '1') return

    /*
      referrer 只在「從站外進來」時才有意義。
      站內換頁時 document.referrer 會是自己的網址，
      送出去只會讓來源統計整片都是自己，看不出客人真正從哪裡來。
    */
    let referrer = ''
    try {
      const from = document.referrer
      if (from && new URL(from).origin !== window.location.origin) referrer = from
    } catch {
      referrer = ''
    }

    api.recordView(location.pathname, referrer).catch(() => {})
  }, [location.pathname, location.search, isStaff])
}
