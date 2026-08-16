import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

const SettingsContext = createContext({ settings: {}, reload: () => {} })

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api
      .getSettings()
      .then((data) => setSettings(data || {}))
      .catch((err) => {
        // 設定拿不到時用空物件，讓網站至少能顯示（各處都有「（待補上）」的預設值）
        console.error('無法載入網站設定：', err.message)
        setSettings({})
      })
  }, [tick])

  const value = useMemo(
    () => ({ settings, reload: () => setTick((t) => t + 1) }),
    [settings],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
