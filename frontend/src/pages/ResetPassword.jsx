import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import PasswordField from '../components/PasswordField'

export default function ResetPassword() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const navigate = useNavigate()

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('密碼至少需要 6 個字元')
    if (form.password !== form.confirm) return setError('兩次輸入的密碼不一致')

    setLoading(true)
    try {
      await api.resetPassword(token, form.password)
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!token) {
    return (
      <section className="section">
        <div className="container form-page">
          <div className="form-card text-center">
            <h1 style={{ fontSize: 21, color: 'var(--honey-900)', marginBottom: 12 }}>連結不完整</h1>
            <p className="muted">請直接點擊信件中的按鈕，或重新申請一次。</p>
            <Link to="/forgot-password" className="btn btn--primary" style={{ marginTop: 16 }}>
              重新申請
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="section">
      <div className="container form-page">
        <div className="text-center" style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 27, color: 'var(--honey-900)' }}>設定新密碼</h1>
        </div>

        {done ? (
          <div className="form-card text-center">
            <div className="alert alert--success" style={{ marginBottom: 16 }}>
              密碼已更新，正在帶你回登入頁…
            </div>
            <Link to="/login" className="btn btn--primary">立即前往登入</Link>
          </div>
        ) : (
          <form className="form-card" onSubmit={submit}>
            {error && (
              <div className="alert alert--error">
                {error}
                {(error.includes('過期') || error.includes('使用過') || error.includes('不正確')) && (
                  <div style={{ marginTop: 10 }}>
                    <Link to="/forgot-password" className="btn btn--outline btn--sm">重新申請一次</Link>
                  </div>
                )}
              </div>
            )}

            <PasswordField
              label="新密碼" name="password" required minLength={6}
              autoComplete="new-password" value={form.password} onChange={change}
              hint="至少 6 個字元"
            />
            <PasswordField
              label="確認新密碼" name="confirm" required
              autoComplete="new-password" value={form.confirm} onChange={change}
              toggleLabel="顯示確認密碼"
            />

            <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
              {loading ? '更新中…' : '更新密碼'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}
