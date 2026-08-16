import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'

export default function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { user, setUser } = useAuth()
  const [state, setState] = useState(token ? 'checking' : 'missing')
  const [message, setMessage] = useState('')
  const done = useRef(false)

  useEffect(() => {
    if (!token || done.current) return
    done.current = true   // React 嚴格模式會執行兩次，這裡擋掉重複送出
    api
      .confirmVerification(token)
      .then((res) => {
        setState('ok')
        setMessage(res.message)
        // 同步更新目前登入者的狀態，不用重新登入
        api.me().then(setUser).catch(() => {})
      })
      .catch((err) => {
        setState('error')
        setMessage(err.message)
      })
  }, [token, setUser])

  return (
    <section className="section">
      <div className="container form-page">
        <div className="form-card text-center">
          {state === 'checking' && (
            <>
              <h1 style={{ fontSize: 21, color: 'var(--honey-900)', marginBottom: 10 }}>驗證中…</h1>
              <p className="muted">請稍候</p>
            </>
          )}

          {state === 'ok' && (
            <>
              <h1 style={{ fontSize: 23, color: 'var(--honey-900)', marginBottom: 12 }}>
                Email 驗證成功
              </h1>
              <p className="muted">{message}</p>
              <p className="small muted">之後的訂單與到貨通知都會寄到這個信箱。</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
                <Link to={user ? '/member' : '/login'} className="btn btn--primary">
                  {user ? '前往會員中心' : '前往登入'}
                </Link>
                <Link to="/products" className="btn btn--outline">開始選購</Link>
              </div>
            </>
          )}

          {(state === 'error' || state === 'missing') && (
            <>
              <h1 style={{ fontSize: 21, color: 'var(--honey-900)', marginBottom: 12 }}>無法完成驗證</h1>
              <p className="muted">{message || '連結不完整，請直接點擊信件中的按鈕。'}</p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
                {user ? (
                  <Link to="/member" className="btn btn--primary">到會員中心重寄驗證信</Link>
                ) : (
                  <Link to="/login" className="btn btn--primary">登入後重寄驗證信</Link>
                )}
                <Link to="/" className="btn btn--ghost">回到首頁</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
