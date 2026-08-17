import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { adminLink, useEditMode } from '../context/EditModeContext'
import { SKIP_SELECTOR, pageTarget } from '../lib/editTargets'

/**
 * 編輯模式的互動層（只有工作人員看得到）。
 *
 * 做法：在 document 上攔一個 click，用 closest('[data-edit]') 找出被點到的
 * 可編輯區塊。這樣頁面上不需要為了編輯模式多包任何元件，
 * 關掉模式時前台跟一般訪客看到的完全一樣。
 *
 * 路徑對照表與略過清單在 ../lib/editTargets.js（純邏輯，另外有測試）。
 */

export default function EditOverlay() {
  const { enabled, toggle } = useEditMode()
  const [spot, setSpot] = useState(null)
  const navigate = useNavigate()
  const location = useLocation()

  // 換頁時把提示收起來
  useEffect(() => setSpot(null), [location.pathname])

  const onDocumentClick = useCallback((event) => {
    // 後台頁面不要攔（那裡本來就是編輯畫面）
    if (window.location.pathname.startsWith('/admin')) return
    // 工具列與導覽照原樣運作
    if (event.target.closest?.(SKIP_SELECTOR)) return

    const el = event.target.closest?.('[data-edit]')

    event.preventDefault()
    event.stopPropagation()

    if (el) {
      setSpot({
        label: el.getAttribute('data-edit-label') || '這個區塊',
        to: el.getAttribute('data-edit'),
        focus: el.getAttribute('data-edit-focus') || '',
        hint: el.getAttribute('data-edit-hint') || '',
        exact: true,
      })
      return
    }

    const fallback = pageTarget(window.location.pathname)
    setSpot(
      fallback
        ? { ...fallback, focus: '', exact: false }
        : { label: '這個區塊', to: '/admin', hint: '這一塊目前寫在程式裡，不是後台可以改的內容。', exact: false },
    )
  }, [])

  useEffect(() => {
    if (!enabled) return undefined
    // 用 capture 階段，才能在連結、按鈕自己的 onClick 之前攔下來
    document.addEventListener('click', onDocumentClick, true)
    // Esc：有提示就先關提示，沒有就直接退出編輯模式（避免感覺被困住）
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (spot) setSpot(null)
      else toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocumentClick, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [enabled, onDocumentClick, spot, toggle])

  const go = () => {
    if (!spot) return
    navigate(adminLink(spot.to, spot.focus))
    setSpot(null)
  }

  if (!enabled) {
    return (
      <button type="button" className="edit-fab" onClick={toggle}
              title="打開後可以直接點網站上的內容去修改">
        編輯模式
      </button>
    )
  }

  return (
    <>
      <div className="edit-bar">
        <span className="edit-bar__dot" />
        <span className="edit-bar__text">
          編輯模式開啟中．<strong>點網站上任何地方</strong>就會問你要不要修改．
          選單和連結照正常運作，可以直接換頁
        </span>
        <button type="button" className="edit-bar__off" onClick={() => { setSpot(null); toggle() }}>
          關閉編輯模式
        </button>
      </div>

      {spot && (
        <>
          <button type="button" className="edit-pop__backdrop" aria-label="關閉"
                  onClick={() => setSpot(null)} />
          <div className="edit-pop" role="dialog" aria-label="修改這個區塊">
            <div className="edit-pop__label">
              {spot.exact ? '這個區塊是' : '這一頁的內容是'}
            </div>
            <div className="edit-pop__title">{spot.label}</div>
            {spot.hint && <p className="edit-pop__hint">{spot.hint}</p>}
            <p className="edit-pop__ask">要現在去修改嗎？</p>
            <div className="edit-pop__actions">
              <button type="button" className="btn btn--primary btn--sm" onClick={go}>
                前往修改
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSpot(null)}>
                先不要
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
