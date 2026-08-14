import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

const SettingsContext = createContext({ settings: {}, reload: () => {} })

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState({})
  const [tick, setTick] = useState(0)

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => setSettings({}))
  }, [tick])

  const value = useMemo(
    () => ({ settings, reload: () => setTick((t) => t + 1) }),
    [settings],
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export const useSettings = () => useContext(SettingsContext)
