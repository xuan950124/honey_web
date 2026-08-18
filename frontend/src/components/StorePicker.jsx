import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../api/client'

/**
 * 超商門市選擇器。
 *
 * 綠界的電子地圖必須用「另開視窗」的方式導轉（官方文件明訂不可放進 iframe，
 * 會被擋住而選不了門市）。買家選完門市後，綠界會把資料 POST 回我們後端的
 * /api/logistics/map/callback，那一頁再用 postMessage 把門市資訊送回這裡。
 *
 * 開新視窗這件事有兩個一定會遇到的狀況，都要處理：
 *
 *   1. **買家把視窗關掉了**（點錯、不想選了、選一半反悔）。
 *      沒有任何訊息會傳回來，所以要自己輪詢 `popup.closed`，
 *      不然按鈕會永遠停在「請在新視窗中選擇門市…」，整個結帳流程卡死。
 *
 *   2. **買家換了另一家超商**。門市代號是綁定超商的，
 *      7-11 的店號拿去寄萊爾富會直接失敗，或更糟 —— 寄到錯的地方。
 *      這件事由 Cart 負責（換送貨方式就清掉門市），這裡只確保
 *      顯示的門市一定屬於目前選的那家。
 */
export default function StorePicker({ shippingMethod, isCollection, store, onSelect, backendOrigin }) {
  const [waiting, setWaiting] = useState(false)
  const [hint, setHint] = useState('')
  const popupRef = useRef(null)
  const pollRef = useRef(null)

  const stopWaiting = useCallback(() => {
    setWaiting(false)
    clearInterval(pollRef.current)
    pollRef.current = null
  }, [])

  const handleMessage = useCallback(
    (event) => {
      if (!event.data || event.data.type !== 'ecpay-store-selected') return
      // 只接受本站或後端來源的訊息
      const allowed = [window.location.origin, backendOrigin].filter(Boolean)
      if (allowed.length && !allowed.includes(event.origin)) return

      const s = event.data.store || {}
      if (!s.storeId) return
      onSelect({
        cvs_store_id: s.storeId,
        cvs_store_name: s.storeName || '',
        cvs_address: s.address || '',
        cvs_telephone: s.telephone || '',
        cvs_outside: s.outside || '',
        // 綠界回傳的超商類型（UNIMARTC2C / FAMIC2C / HILIFEC2C）。
        // 送到後端做交叉檢查：門市代號綁定超商，寄錯家的包裹是找不回來的。
        cvs_sub_type: s.subType || '',
      })
      setHint('')
      stopWaiting()
    },
    [onSelect, backendOrigin, stopWaiting],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

  // 元件被移除（例如改選宅配）時，把還開著的視窗與輪詢一起收掉
  useEffect(() => () => {
    clearInterval(pollRef.current)
    try { popupRef.current?.close() } catch { /* 跨網域時關不掉，忽略 */ }
  }, [])

  // 換超商時把等待狀態清掉，並關掉還開著的舊地圖 ——
  // 那一頁是上一家超商的，選了也不能用
  useEffect(() => {
    stopWaiting()
    setHint('')
    try { popupRef.current?.close() } catch { /* 忽略 */ }
    popupRef.current = null
  }, [shippingMethod, stopWaiting])

  // 若瀏覽器擋掉 postMessage（例如在同一分頁開啟），回呼頁會帶參數導回本頁
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const storeId = params.get('storeId')
    if (storeId) {
      onSelect({
        cvs_store_id: storeId,
        cvs_store_name: params.get('storeName') || '',
        cvs_address: params.get('address') || '',
        cvs_telephone: params.get('telephone') || '',
        cvs_outside: params.get('outside') || '',
      })
      window.history.replaceState({}, '', window.location.pathname)
    }
    // 只在掛載時檢查一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = () => {
    setHint('')
    const url = apiUrl(
      `/api/logistics/map?shipping_method=${encodeURIComponent(shippingMethod)}&is_collection=${isCollection ? 'Y' : 'N'}`,
    )
    const w = 1000
    const h = 700
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
    const popup = window.open(
      url, 'ecpay-store-map',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    )
    if (!popup) {
      setHint('瀏覽器擋住了彈出視窗。請允許本站開啟新視窗，或改用其他配送方式。')
      return
    }

    popupRef.current = popup
    setWaiting(true)

    // 買家關掉視窗時沒有任何事件會通知我們，只能自己看。
    // 每 0.5 秒檢查一次，關掉了就把按鈕還原。
    clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      let closed = false
      try { closed = popup.closed } catch { closed = true }
      if (!closed) return
      stopWaiting()
      // 用函式形式讀最新的 store：這個輪詢是在 open() 當下建立的，
      // 直接讀外面的 store 會拿到當時的舊值
      setHint((prev) => prev || '視窗關閉了，還沒有選到門市。可以再按一次重新選擇。')
    }, 500)
  }

  return (
    <div>
      {store?.cvs_store_id ? (
        <div className="store-card">
          <div>
            <div className="store-card__name">{store.cvs_store_name || '已選擇門市'}</div>
            <div className="store-card__addr">{store.cvs_address}</div>
            <div className="small muted">
              店號 {store.cvs_store_id}
              {store.cvs_telephone ? `．${store.cvs_telephone}` : ''}
              {store.cvs_outside === '1' ? '．離島門市' : ''}
            </div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={open}>
            {waiting ? '選擇中…' : '重新選擇'}
          </button>
        </div>
      ) : (
        <div className="store-empty">
          <button type="button" className="btn btn--outline" onClick={open}>
            {waiting ? '請在新視窗中選擇門市…' : '選擇取貨門市'}
          </button>
          {waiting && (
            <button type="button" className="linkish small" style={{ marginTop: 10 }}
                    onClick={() => {
                      stopWaiting()
                      try { popupRef.current?.close() } catch { /* 忽略 */ }
                    }}>
              取消，我不選了
            </button>
          )}
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            {hint || '會開啟超商的門市地圖，選好後視窗會自動關閉並帶回門市資料'}
          </p>
        </div>
      )}
    </div>
  )
}
