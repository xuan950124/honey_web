import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * 裝置預覽（僅工作人員可見）。
 *
 * 做法上用 iframe 而不是單純把容器縮窄，因為 CSS 的 media query 是看
 * 「可視區域寬度」而不是容器寬度。只有 iframe 才會讓網站真的以手機寬度
 * 重新計算版面，看到的才是使用者手機上的實際畫面。
 *
 * iframe 內的網址會帶 ?preview=1，讓裡面那一層不要再顯示這個工具列，
 * 避免無限巢狀。
 */
const DEVICES = [
  { key: 'iphone', label: 'iPhone 15', width: 393, height: 852 },
  { key: 'iphone-se', label: 'iPhone SE', width: 375, height: 667 },
  { key: 'android', label: 'Android', width: 412, height: 915 },
  { key: 'ipad', label: 'iPad', width: 820, height: 1180 },
]

export default function DevicePreview() {
  const [open, setOpen] = useState(false)
  const [deviceKey, setDeviceKey] = useState('iphone')
  const [landscape, setLandscape] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const location = useLocation()

  const device = DEVICES.find((d) => d.key === deviceKey) || DEVICES[0]
  const width = landscape ? device.height : device.width
  const height = landscape ? device.width : device.height

  // iframe 一律從目前的頁面開始，方便直接檢視正在編輯的畫面
  const src = useMemo(() => {
    const params = new URLSearchParams(location.search)
    params.set('preview', '1')
    return `${location.pathname}?${params.toString()}`
    // reloadKey 改變時重新計算，達成重新載入的效果
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, reloadKey])

  // 開啟時鎖住背景捲動，並支援 Esc 關閉
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 視窗放不下時等比例縮小，維持正確的長寬比
  const [scale, setScale] = useState(1)
  useEffect(() => {
    if (!open) return undefined
    const fit = () => {
      const availableH = window.innerHeight - 190
      const availableW = window.innerWidth - 80
      setScale(Math.min(1, availableH / height, availableW / width))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [open, width, height])

  if (!open) {
    return (
      <button type="button" className="preview-fab" onClick={() => setOpen(true)}
              title="以手機尺寸檢視這個頁面">
        手機版預覽
      </button>
    )
  }

  return (
    <div className="preview-overlay" role="dialog" aria-label="裝置預覽">
      <div className="preview-bar">
        <div className="preview-bar__group">
          {DEVICES.map((d) => (
            <button type="button" key={d.key}
                    className={`preview-chip${deviceKey === d.key ? ' active' : ''}`}
                    onClick={() => setDeviceKey(d.key)}>
              {d.label}
            </button>
          ))}
        </div>

        <div className="preview-bar__group">
          <span className="preview-size">{width} × {height}</span>
          <button type="button" className="preview-chip" onClick={() => setLandscape((v) => !v)}>
            {landscape ? '直向' : '橫向'}
          </button>
          <button type="button" className="preview-chip" onClick={() => setReloadKey((k) => k + 1)}>
            重新載入
          </button>
          <button type="button" className="preview-chip preview-chip--close" onClick={() => setOpen(false)}>
            關閉
          </button>
        </div>
      </div>

      <div className="preview-stage">
        <div className="preview-device"
             style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
          <div className="preview-notch" />
          <iframe
            key={`${src}-${width}-${height}`}
            className="preview-frame"
            src={src}
            title="手機版預覽"
          />
        </div>
      </div>

      <p className="preview-hint">
        這是網站在該尺寸下的實際畫面，可以直接在裡面點擊操作．按 Esc 關閉
      </p>
    </div>
  )
}
