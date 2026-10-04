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

/*
  保持登入：登入權杖 30 天後過期，但只要權杖發出超過一天，
  打開網站（或切回這個分頁）時就自動換一張新的，效期重新起算。
  所以有在用就一直保持登入，連續 30 天沒來才要重新登入。
  一天才換一次，不用每次換頁都多打一支 API。
*/
const RENEW_AFTER_SECONDS = 24 * 60 * 60

// 切回分頁時重新跟後端確認登入狀態，最多五分鐘一次（見 verify）
const RECHECK_AFTER_MS = 5 * 60 * 1000
let lastVerified = 0

/** 權杖是什麼時候發的（秒）。2026-10 以前的權杖沒有 iat，當作很久以前。 */
function issuedAt(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)))
    return typeof payload.iat === 'number' ? payload.iat : 0
  } catch {
    return 0
  }
}

/** onInvalid：後端說這張權杖已經不能用（過期、在別的裝置改了密碼）時要做的事。 */
function renewIfOld(onInvalid) {
  const token = getToken()
  if (!token || Date.now() / 1000 - issuedAt(token) < RENEW_AFTER_SECONDS) return
  api
    .refresh()
    .then((data) => {
      // 換的時候剛好登出或換了帳號，就不要把新權杖寫回去
      if (getToken() === token) setToken(data.access_token)
    })
    .catch((err) => {
      // 401 代表這張權杖已經失效。不登出的話，畫面看起來還在登入，
      // 結帳時卻被當成訪客：會員價不見、優惠券不能用、訂單也不會記在帳號下。
      // 其他錯誤（斷網、後端重啟）就算了，舊的權杖還能用到過期。
      if (err.status === 401 && getToken() === token) onInvalid()
    })
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

  // 跟後端確認權杖還有效、順便更新會員資料；有效的話再看要不要換新權杖
  const verify = useCallback(() => {
    const sent = getToken()
    if (!sent) {
      setUser(null)
      return Promise.resolve()
    }
    lastVerified = Date.now()
    return api
      .me()
      .then((data) => {
        if (getToken() !== sent) return   // 確認到一半登出或換了帳號
        setUser(data)
        renewIfOld(logout)
      })
      .catch((err) => {
        // 只有伺服器明確說「權杖無效」才登出。
        // 網路瞬斷、後端暖機中、逾時、500 這些都是暫時性問題，
        // 若一律清掉權杖，使用者會莫名其妙被登出。
        // 而且只清掉「剛剛送出去的那一張」：另一個分頁可能剛改完密碼、換了新權杖，
        // 這裡不能把新的也一起清掉。
        if (err.status === 401 || err.status === 403) {
          if (getToken() === sent) logout()
        } else {
          console.warn('無法確認登入狀態，暫時沿用先前的登入資料：', err.message)
        }
      })
  }, [setUser, logout])

  useEffect(() => {
    verify().finally(() => setLoading(false))
  }, [verify])

  // 後台分頁常常一開好幾天不重新整理。切回來時重新確認一次：
  // 在別的裝置改了密碼、或權杖過期了，這裡才會跟著登出，
  // 不會畫面看起來還在登入、結帳時卻被當成訪客。最多五分鐘問一次後端。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastVerified > RECHECK_AFTER_MS) verify()
      else renewIfOld(logout)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [verify, logout])

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
