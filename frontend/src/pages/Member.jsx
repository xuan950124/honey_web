import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LOGISTICS_STATUS_TEXT, ORDER_STATUS_TEXT, PAYMENT_STATUS_TEXT,
  api, formatDate, formatPrice,
} from '../api/client'
import PasswordField from '../components/PasswordField'
import { useAuth } from '../context/AuthContext'

export default function Member() {
  const { user, setUser, isStaff } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // 信箱驗證
  const [verifyMsg, setVerifyMsg] = useState(null)
  const [verifyErr, setVerifyErr] = useState('')
  const [sending, setSending] = useState(false)

  // 變更密碼
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [pwSaving, setPwSaving] = useState(false)

  const resend = async () => {
    setVerifyErr(''); setVerifyMsg(null); setSending(true)
    try {
      setVerifyMsg(await api.resendVerification())
    } catch (e) {
      setVerifyErr(e.message)
    } finally {
      setSending(false)
    }
  }

  const changePw = async (e) => {
    e.preventDefault()
    setPwErr(''); setPwMsg('')
    if (pw.new_password.length < 6) return setPwErr('新密碼至少需要 6 個字元')
    if (pw.new_password !== pw.confirm) return setPwErr('兩次輸入的新密碼不一致')
    setPwSaving(true)
    try {
      const res = await api.changePassword(pw.current_password, pw.new_password)
      setPwMsg(res.message)
      setPw({ current_password: '', new_password: '', confirm: '' })
    } catch (e) {
      setPwErr(e.message)
    } finally {
      setPwSaving(false)
    }
  }

  const changePwField = (e) => setPw((p) => ({ ...p, [e.target.name]: e.target.value }))

  useEffect(() => {
    if (user) setForm({ name: user.name || '', phone: user.phone || '', address: user.address || '' })
  }, [user])

  useEffect(() => {
    api.myOrders().then(setOrders).catch(() => setOrders([])).finally(() => setLoading(false))
  }, [])

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setMsg(''); setErr('')
    try {
      const updated = await api.updateMe(form)
      setUser(updated)
      setMsg('資料已更新')
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">會員中心</h1>
          <p className="page-hero__desc">
            {user?.name}　
            <span className={`tag tag--${isStaff ? 'staff' : 'member'}`}>
              {isStaff ? '工作人員' : '一般會員'}
            </span>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          {user && !user.email_verified && (
            <div className="alert alert--error" style={{ marginBottom: 24 }}>
              <strong>你的 Email 還沒完成驗證</strong>
              <p className="small" style={{ margin: '6px 0 10px' }}>
                驗證後才能收到訂單成立與到貨通知。驗證信寄到 {user.email}。
              </p>
              {verifyErr && <div className="small" style={{ color: 'var(--danger)', marginBottom: 8 }}>{verifyErr}</div>}
              {verifyMsg && (
                <div className="small" style={{ color: 'var(--success)', marginBottom: 8 }}>
                  {verifyMsg.message}
                  {verifyMsg.dev_url && (
                    <>
                      {'　'}
                      <a href={verifyMsg.dev_url} style={{ textDecoration: 'underline', fontWeight: 500 }}>
                        （開發模式）直接點此完成驗證
                      </a>
                    </>
                  )}
                </div>
              )}
              <button type="button" className="btn btn--outline btn--sm" onClick={resend} disabled={sending}>
                {sending ? '寄送中…' : '重寄驗證信'}
              </button>
            </div>
          )}

          {isStaff && (
            <div className="alert alert--info" style={{ marginBottom: 24 }}>
              您是工作人員帳號，可前往
              <Link to="/admin" style={{ textDecoration: 'underline', fontWeight: 500 }}> 後台管理 </Link>
              新增商品、上傳照片與管理訂單。
            </div>
          )}

          <div className="panel">
            <h2 className="panel__title">我的訂單</h2>
            {loading ? (
              <div className="loading">載入中…</div>
            ) : orders.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>訂單編號</th><th>日期</th><th>商品</th><th>金額</th>
                      <th>付款</th><th>配送</th><th>狀態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td style={{ fontFamily: 'monospace' }}>
                          <Link to={`/order/${o.order_no}`}>{o.order_no}</Link>
                        </td>
                        <td>{formatDate(o.created_at)}</td>
                        <td>
                          {o.items.map((i) => (
                            <div key={i.id} className="small">
                              {i.product_name} × {i.quantity}
                            </div>
                          ))}
                        </td>
                        <td>NT${formatPrice(o.total_amount)}</td>
                        <td>
                          <span className={`tag tag--${o.payment_status === 'paid' ? 'shipped' : 'pending'}`}>
                            {o.payment_method === 'cod' ? '貨到付款' : PAYMENT_STATUS_TEXT[o.payment_status]}
                          </span>
                        </td>
                        <td className="small">
                          {o.shipping_method_label}
                          {o.logistics_status !== 'none' && (
                            <div className="muted">{LOGISTICS_STATUS_TEXT[o.logistics_status]}</div>
                          )}
                        </td>
                        <td><span className={`tag tag--${o.status}`}>{ORDER_STATUS_TEXT[o.status]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state" style={{ padding: '36px 20px' }}>
                <div className="empty-state__title">還沒有訂單紀錄</div>
                <Link to="/products" className="btn btn--outline" style={{ marginTop: 14 }}>去逛逛</Link>
              </div>
            )}
          </div>

          <div className="panel">
            <h2 className="panel__title">個人資料</h2>
            {msg && <div className="alert alert--success">{msg}</div>}
            {err && <div className="alert alert--error">{err}</div>}
            <form onSubmit={save} style={{ maxWidth: 520 }}>
              <div className="field">
                <label htmlFor="m-email">Email</label>
                <input id="m-email" className="input" value={user?.email || ''} disabled />
                <div className="field__hint">
                  Email 為登入帳號，無法修改．
                  {user?.email_verified ? (
                    <span style={{ color: 'var(--success)' }}>已完成驗證</span>
                  ) : (
                    <span style={{ color: 'var(--danger)' }}>尚未驗證</span>
                  )}
                </div>
              </div>
              <div className="field">
                <label htmlFor="m-name">姓名</label>
                <input id="m-name" className="input" name="name" value={form.name} onChange={change} />
              </div>
              <div className="field">
                <label htmlFor="m-phone">聯絡電話</label>
                <input id="m-phone" className="input" name="phone" value={form.phone} onChange={change} />
              </div>
              <div className="field">
                <label htmlFor="m-address">常用收件地址</label>
                <input id="m-address" className="input" name="address" value={form.address} onChange={change} />
              </div>
              <button type="submit" className="btn btn--primary">儲存變更</button>
            </form>
          </div>

          <div className="panel">
            <h2 className="panel__title">變更密碼</h2>
            {pwMsg && <div className="alert alert--success">{pwMsg}</div>}
            {pwErr && <div className="alert alert--error">{pwErr}</div>}
            <form onSubmit={changePw} style={{ maxWidth: 520 }}>
              <PasswordField
                label="目前的密碼" name="current_password" required
                autoComplete="current-password"
                value={pw.current_password} onChange={changePwField}
              />
              <PasswordField
                label="新密碼" name="new_password" required minLength={6}
                autoComplete="new-password" hint="至少 6 個字元"
                value={pw.new_password} onChange={changePwField}
              />
              <PasswordField
                label="確認新密碼" name="confirm" required
                autoComplete="new-password" toggleLabel="顯示確認密碼"
                value={pw.confirm} onChange={changePwField}
              />
              <button type="submit" className="btn btn--primary" disabled={pwSaving}>
                {pwSaving ? '更新中…' : '更新密碼'}
              </button>
            </form>
          </div>
        </div>
      </section>
    </>
  )
}
