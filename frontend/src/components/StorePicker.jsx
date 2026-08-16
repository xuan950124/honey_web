import { useCallback, useEffect, useRef, useState } from 'react'
import { apiUrl } from '../api/client'

/**
 * 超商門市選擇器。
 *
 * 綠界的電子地圖必須用「另開視窗」的方式導轉（官方文件明訂不可放進 iframe，
 * 會被擋住而選不了門市）。買家選完門市後，綠界會把資料 POST 回我們後端的
 * /api/logistics/map/callback，那一頁再用 postMessage 把門市資訊送回這裡。
 */
export default function StorePicker({ shippingMethod, isCollection, store, onSelect, backendOrigin }) {
  const [waiting, setWaiting] = useState(false)
  const popupRef = useRef(null)

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
      })
      setWaiting(false)
    },
    [onSelect, backendOrigin],
  )

  useEffect(() => {
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [handleMessage])

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
    const url = apiUrl(
      `/api/logistics/map?shipping_method=${encodeURIComponent(shippingMethod)}&is_collection=${isCollection ? 'Y' : 'N'}`,
    )
    const w = 1000
    const h = 700
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
    popupRef.current = window.open(
      url, 'ecpay-store-map',
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    )
    if (!popupRef.current) {
      window.alert('瀏覽器擋住了彈出視窗，請允許本站開啟新視窗後再試一次。')
      return
    }
    setWaiting(true)
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
            重新選擇
          </button>
        </div>
      ) : (
        <div className="store-empty">
          <button type="button" className="btn btn--outline" onClick={open}>
            {waiting ? '請在新視窗中選擇門市…' : '選擇取貨門市'}
          </button>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            會開啟超商的門市地圖，選好後視窗會自動關閉並帶回門市資料
          </p>
        </div>
      )}
    </div>
  )
}
