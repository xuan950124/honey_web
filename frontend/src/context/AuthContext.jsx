import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, clearToken, getToken, setToken } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me()
      .then(setUser)
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await api.login({ email, password })
    setToken(data.access_token)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await api.register(payload)
    setToken(data.access_token)
    setUser(data.user)
    return data
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({ user, setUser, loading, login, register, logout, isStaff: user?.role === 'staff' }),
    [user, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
