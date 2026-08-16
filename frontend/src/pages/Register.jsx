import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PasswordField from '../components/PasswordField'
import { useAuth } from '../context/AuthContext'

export default function Register() {
  const [form, setForm] = useState({
    email: '', password: '', confirm: '', name: '', phone: '', address: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(null)
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
      const res = await register({
        email: form.email,
        password: form.password,
        name: form.name,
        phone: form.phone || null,
        address: form.address || null,
      })
      setDone(res)
      window.scrollTo(0, 0)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <section className="section">
        <div className="container form-page">
          <div className="form-card text-center">
            <h1 style={{ fontSize: 24, color: 'var(--honey-900)', marginBottom: 12 }}>註冊完成</h1>
            <p className="muted">
              我們寄了一封驗證信到 <strong style={{ color: 'var(--honey-700)' }}>{form.email}</strong>，
              請點信中的連結完成驗證。
            </p>
            <p className="small muted">沒收到的話，請檢查垃圾郵件匣，或稍後到會員中心重寄。</p>

            {done.dev_verify_url && (
              <div className="alert alert--info" style={{ textAlign: 'left', marginTop: 18 }}>
                <strong>開發模式</strong>：目前尚未設定寄信服務，可直接點下面的連結完成驗證。
                <div style={{ marginTop: 10 }}>
                  <a href={done.dev_verify_url} className="btn btn--primary btn--sm">直接完成驗證</a>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 22, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--primary" onClick={() => navigate('/member')}>
                前往會員中心
              </button>
              <button type="button" className="btn btn--outline" onClick={() => navigate('/products')}>
                開始選購
              </button>
            </div>
          </div>
        </div>
      </section>
    )
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
            <PasswordField
              label="密碼" name="password" required minLength={6}
              autoComplete="new-password" value={form.password} onChange={change}
              hint="至少 6 個字元"
            />
            <PasswordField
              label="確認密碼" name="confirm" required
              autoComplete="new-password" value={form.confirm} onChange={change}
              toggleLabel="顯示確認密碼"
            />
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
