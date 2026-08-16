import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, clearToken, getToken, setToken } from '../api/client'

const AuthContext = createContext(null)

// 把登入者資料快取起來，重新整理時才不會先閃一下「會員登入」再變回名字
const USER_CACHE_KEY = 'honey_user_v1'

function readCachedUser() {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY)
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data === 'object' && data.id ? data : null
  } catch {
    return null
  }
}

function writeCachedUser(user) {
  try {
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_CACHE_KEY)
  } catch {
    // 無痕模式寫入會失敗，忽略即可
  }
}

export function AuthProvider({ children }) {
  // 有權杖又有快取就先當作已登入，等後端確認後再更新
  const [user, setUserState] = useState(() => (getToken() ? readCachedUser() : null))
  const [loading, setLoading] = useState(Boolean(getToken()))

  const setUser = useCallback((value) => {
    setUserState(value)
    writeCachedUser(value)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
  }, [setUser])

  useEffect(() => {
    if (!getToken()) {
      setUser(null)
      setLoading(false)
      return
    }

    api
      .me()
      .then((data) => setUser(data))
      .catch((err) => {
        // 只有伺服器明確說「權杖無效」才登出。
        // 網路瞬斷、後端暖機中、逾時、500 這些都是暫時性問題，
        // 若一律清掉權杖，使用者會莫名其妙被登出。
        if (err.status === 401 || err.status === 403) {
          clearToken()
          setUser(null)
        } else {
          console.warn('無法確認登入狀態，暫時沿用先前的登入資料：', err.message)
        }
      })
      .finally(() => setLoading(false))
  }, [setUser])

  const login = useCallback(
    async (email, password) => {
      const data = await api.login({ email, password })
      setToken(data.access_token)
      setUser(data.user)
      return data.user
    },
    [setUser],
  )

  const register = useCallback(
    async (payload) => {
      const data = await api.register(payload)
      setToken(data.access_token)
      setUser(data.user)
      return data
    },
    [setUser],
  )

  const value = useMemo(
    () => ({ user, setUser, loading, login, register, logout, isStaff: user?.role === 'staff' }),
    [user, setUser, loading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth 必須在 AuthProvider 內使用')
  return ctx
}
