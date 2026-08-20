import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import { withMapDefaults } from '../lib/maps'

const SettingsContext = createContext({ settings: {}, loaded: false, reload: () => {} })

// 把設定快取在瀏覽器，避免每次進站都先閃一下預設值再換成正確的店名。
const CACHE_KEY = 'honey_settings_v1'

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // 無痕模式或空間不足時寫入會失敗，忽略即可（只是少了快取）
  }
}

export function SettingsProvider({ children }) {
  const cached = useMemo(readCache, [])
  const [settings, setSettings] = useState(cached || {})
  // 有快取就當作已載入，畫面可以立刻顯示正確的店名
  const [loaded, setLoaded] = useState(Boolean(cached))
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api
      .getSettings()
      .then((data) => {
        const value = data || {}
        setSettings(value)
        setLoaded(true)
        writeCache(value)
      })
      .catch((err) => {
        // 拿不到設定時，有快取就繼續用快取，沒有就用空值（各處都有「（待補上）」）
        console.error('無法載入網站設定：', err.message)
        setLoaded(true)
      })
  }, [tick])

  /*
    地圖那兩欄補上出廠預設（見 lib/maps.js）。

    「地圖指到隔壁」這件事已經來回修過好幾次，網站一部署就該是對的，
    不該取決於有沒有人記得去後台貼一次分享連結。後台填了就以後台為準。

    只補給前台用的這一份 —— 後台編輯頁走 api.getSettings()，
    看到的仍是真正存在資料庫裡的值（空的就是空的），
    不會讓人以為自己填過了。
  */
  const value = useMemo(
    () => ({
      settings: withMapDefaults(settings),
      loaded,
      reload: () => setTick((t) => t + 1),
    }),
    [settings, loaded],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
