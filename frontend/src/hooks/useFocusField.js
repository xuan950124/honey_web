import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * 從前台編輯模式跳過來時（網址帶 ?focus=欄位名），
 * 自動捲到那個欄位、加上高亮並聚焦。
 *
 * 為什麼要等 ready：後台頁面的欄位是等 API 回來才畫出來的，
 * 一進頁面就找 DOM 會找不到。所以由呼叫端在資料載入完成後把 ready 設為 true。
 *
 * @param ready 欄位已經畫到畫面上了嗎
 */
export default function useFocusField(ready = true) {
  const [params, setParams] = useSearchParams()
  const focus = params.get('focus')

  useEffect(() => {
    if (!focus || !ready) return undefined

    // 給瀏覽器一格時間完成排版，不然 scrollIntoView 會算錯位置
    const timer = setTimeout(() => {
      const input = document.getElementById(focus)
      const field = input?.closest('.field') || document.querySelector(`[data-field="${focus}"]`)
      const target = field || input
      if (!target) return

      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('is-focus-target')
      // 圖片上傳這種沒有 input 的欄位就只高亮，不要硬 focus
      if (input && typeof input.focus === 'function') {
        input.focus({ preventScroll: true })
      }

      // 高亮只是「告訴你是這一格」，看到了就該消失，
      // 不然之後在同一頁改別的東西會一直有個東西在閃
      setTimeout(() => target.classList.remove('is-focus-target'), 2600)

      // 網址上的 focus 也一併清掉，重新整理時不會又閃一次
      const next = new URLSearchParams(params)
      next.delete('focus')
      setParams(next, { replace: true })
    }, 120)

    return () => clearTimeout(timer)
    // params / setParams 每次 render 都是新物件，放進相依會無限迴圈
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready])

  return focus
}
