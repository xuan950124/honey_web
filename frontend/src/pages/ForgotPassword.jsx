import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      setSent(await api.forgotPassword(email))
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
          <h1 style={{ fontSize: 27, color: 'var(--honey-900)' }}>忘記密碼</h1>
          <p className="muted small" style={{ marginTop: 8 }}>
            輸入註冊時使用的 Email，我們會寄一封重設密碼的信給你
          </p>
        </div>

        {sent ? (
          <div className="form-card text-center">
            <h2 style={{ fontSize: 19, color: 'var(--honey-800)', marginBottom: 12 }}>信件已寄出</h2>
            <p className="muted" style={{ fontSize: 14.5 }}>{sent.message}</p>
            <p className="small muted">
              沒收到的話，請檢查垃圾郵件匣。連結有效時間為 1 小時。
            </p>

            {sent.dev_url && (
              <div className="alert alert--info" style={{ textAlign: 'left', marginTop: 18 }}>
                <strong>開發模式</strong>：目前尚未設定寄信服務，可直接點下面的連結重設密碼。
                <div style={{ marginTop: 10 }}>
                  <a href={sent.dev_url} className="btn btn--primary btn--sm">直接前往重設密碼</a>
                </div>
              </div>
            )}

            <div style={{ marginTop: 22 }}>
              <Link to="/login" className="btn btn--outline">回到登入</Link>
            </div>
          </div>
        ) : (
          <form className="form-card" onSubmit={submit}>
            {error && <div className="alert alert--error">{error}</div>}

            <div className="field">
              <label htmlFor="email">Email<span className="req">*</span></label>
              <input id="email" className="input" type="email" required autoComplete="username"
                     value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
              {loading ? '寄送中…' : '寄出重設密碼的信'}
            </button>

            <p className="text-center small muted" style={{ marginTop: 18, marginBottom: 0 }}>
              想起來了？<Link to="/login" style={{ color: 'var(--honey-600)', textDecoration: 'underline' }}>回到登入</Link>
            </p>
          </form>
        )}
      </div>
    </section>
  )
}
