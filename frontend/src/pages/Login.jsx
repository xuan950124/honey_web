import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await login(form.email, form.password)
      const from = location.state?.from
      navigate(from || (user.role === 'staff' ? '/admin' : '/member'), { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="section">
      <div className="container form-page">
        <div className="text-center" style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 27, color: 'var(--honey-900)' }}>會員登入</h1>
          <p className="muted small" style={{ marginTop: 8 }}>登入後可查詢訂單、快速填入收件資料</p>
        </div>

        <form className="form-card" onSubmit={submit}>
          {error && <div className="alert alert--error">{error}</div>}

          <div className="field">
            <label htmlFor="email">Email<span className="req">*</span></label>
            <input id="email" className="input" type="email" name="email" required
                   autoComplete="username" value={form.email} onChange={change} />
          </div>

          <div className="field">
            <label htmlFor="password">密碼<span className="req">*</span></label>
            <input id="password" className="input" type="password" name="password" required
                   autoComplete="current-password" value={form.password} onChange={change} />
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
            {loading ? '登入中…' : '登入'}
          </button>

          <p className="text-center small muted" style={{ marginTop: 18, marginBottom: 0 }}>
            還沒有帳號？<Link to="/register" style={{ color: 'var(--honey-600)', textDecoration: 'underline' }}>立即註冊</Link>
          </p>
        </form>

        <div className="alert alert--info" style={{ marginTop: 20 }}>
          工作人員帳號請由管理員於資料庫建立（role 設為 staff），登入後會自動出現「後台管理」選單。
        </div>
      </div>
    </section>
  )
}
