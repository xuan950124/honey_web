import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const [form, setForm] = useState({
    email: '', password: '', confirm: '', name: '', phone: '', address: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('密碼至少需要 6 個字元')
    if (form.password !== form.confirm) return setError('兩次輸入的密碼不一致')

    setLoading(true)
    try {
      await register({
        email: form.email,
        password: form.password,
        name: form.name,
        phone: form.phone || null,
        address: form.address || null,
      })
      navigate('/member', { replace: true })
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
          <h1 style={{ fontSize: 27, color: 'var(--honey-900)' }}>加入會員</h1>
          <p className="muted small" style={{ marginTop: 8 }}>免費註冊，訂單紀錄一目了然</p>
        </div>

        <form className="form-card" onSubmit={submit}>
          {error && <div className="alert alert--error">{error}</div>}

          <div className="field">
            <label htmlFor="name">姓名<span className="req">*</span></label>
            <input id="name" className="input" name="name" required value={form.name} onChange={change} />
          </div>

          <div className="field">
            <label htmlFor="email">Email<span className="req">*</span></label>
            <input id="email" className="input" type="email" name="email" required
                   autoComplete="username" value={form.email} onChange={change} />
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="password">密碼<span className="req">*</span></label>
              <input id="password" className="input" type="password" name="password" required minLength={6}
                     autoComplete="new-password" value={form.password} onChange={change} />
              <div className="field__hint">至少 6 個字元</div>
            </div>
            <div className="field">
              <label htmlFor="confirm">確認密碼<span className="req">*</span></label>
              <input id="confirm" className="input" type="password" name="confirm" required
                     autoComplete="new-password" value={form.confirm} onChange={change} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="phone">聯絡電話</label>
            <input id="phone" className="input" name="phone" value={form.phone} onChange={change} />
          </div>

          <div className="field">
            <label htmlFor="address">常用收件地址</label>
            <input id="address" className="input" name="address" value={form.address} onChange={change} />
            <div className="field__hint">填寫後，下單時會自動帶入</div>
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
            {loading ? '註冊中…' : '註冊'}
          </button>

          <p className="text-center small muted" style={{ marginTop: 18, marginBottom: 0 }}>
            已經有帳號了？<Link to="/login" style={{ color: 'var(--honey-600)', textDecoration: 'underline' }}>前往登入</Link>
          </p>
        </form>
      </div>
    </section>
  )
}
