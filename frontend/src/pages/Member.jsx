import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LOGISTICS_STATUS_TEXT, ORDER_STATUS_TEXT, PAYMENT_STATUS_TEXT,
  api, checkoutUrl, formatDate, formatPrice, orderUrl,
} from '../api/client'
import CouponCard from '../components/CouponCard'
import PasswordField from '../components/PasswordField'
import { useAuth } from '../context/AuthContext'

export default function Member() {
  const { user, setUser, isStaff } = useAuth()
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // 會員等級與折價券
  const [membership, setMembership] = useState(null)

  useEffect(() => {
    api.membership().then(setMembership).catch(() => setMembership(null))
  }, [])

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

  // 還沒付款的訂單。放在最上面 —— 這是進會員中心第一眼就該看到的事，
  // 埋在訂單表格裡買家很容易以為自己已經買到了。
  const unpaid = orders.filter((o) => o.can_retry_payment)

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

          {unpaid.length > 0 && (
            <div className="unpaid-box">
              <div className="unpaid-box__title">
                有 {unpaid.length} 筆訂單還沒完成付款
              </div>
              <p className="small" style={{ margin: '0 0 14px', color: 'var(--honey-800)' }}>
                我們會先幫你保留商品，完成付款後才會安排出貨。
              </p>
              {unpaid.map((o) => (
                <div className="unpaid-row" key={o.id}>
                  <div>
                    <Link to={orderUrl(o)} style={{ fontFamily: 'monospace' }}>
                      {o.order_no}
                    </Link>
                    <div className="small muted">
                      {o.items.map((i) => `${i.product_name}×${i.quantity}`).join('、')}
                      　NT${formatPrice(o.total_amount)}
                      {o.payment_status === 'failed' && (
                        <span style={{ color: 'var(--danger)' }}>　付款失敗</span>
                      )}
                    </div>
                  </div>
                  <a
                    className="btn btn--primary btn--sm"
                    href={checkoutUrl(o)}
                  >
                    立即付款
                  </a>
                </div>
              ))}
            </div>
          )}

          {isStaff && (
            <div className="alert alert--info" style={{ marginBottom: 24 }}>
              您是工作人員帳號，可前往
              <Link to="/admin" style={{ textDecoration: 'underline', fontWeight: 500 }}> 後台管理 </Link>
              新增商品、上傳照片與管理訂單。
            </div>
          )}

          {membership && (
            <>
              <div className="cart-layout" style={{ marginBottom: 22 }}>
                <div className="tier-card">
                  <div className="tier-card__label">MEMBERSHIP</div>
                  <div className="tier-card__name">{membership.tier?.name || '一般會員'}</div>
                  <div className="tier-card__perk">
                    {Number(membership.tier?.discount_percent) > 0
                      ? `每筆訂單享 ${(100 - Number(membership.tier.discount_percent)) / 10} 折優惠`
                      : '消費累積可升級，享受更多優惠'}
                  </div>

                  <div className="tier-card__spent">
                    <div className="tier-card__label" style={{ marginBottom: 4 }}>累積消費</div>
                    <div className="tier-card__amount">NT${formatPrice(membership.total_spent)}</div>

                    {membership.next_tier && (
                      <div className="tier-progress">
                        <div className="tier-progress__bar">
                          <div
                            className="tier-progress__fill"
                            style={{
                              width: `${Math.min(
                                100,
                                (Number(membership.total_spent) /
                                  Number(membership.next_tier.min_spent)) * 100,
                              )}%`,
                            }}
                          />
                        </div>
                        <div className="tier-progress__text">
                          再消費 NT${formatPrice(membership.amount_to_next_tier)} 可升級為
                          {membership.next_tier.name}
                        </div>
                      </div>
                    )}
                    {!membership.next_tier && membership.tier && (
                      <div className="tier-progress__text" style={{ marginTop: 12 }}>
                        已達最高等級，感謝你的支持
                      </div>
                    )}
                  </div>
                </div>

                <div className="panel" style={{ margin: 0 }}>
                  <h2 className="panel__title">我的折價券（{membership.coupons.length}）</h2>
                  {membership.coupons.length ? (
                    <div className="coupon-list">
                      {membership.coupons.map((c) => <CouponCard key={c.id} coupon={c} />)}
                    </div>
                  ) : (
                    <p className="small muted" style={{ margin: 0 }}>
                      目前沒有可用的折價券。累積消費達標或完成信箱驗證都會自動獲得。
                    </p>
                  )}
                </div>
              </div>

              {membership.tiers.length > 0 && (
                <div className="panel">
                  <h2 className="panel__title">會員等級與優惠</h2>
                  <div className="table-wrap" style={{ border: 'none' }}>
                    <table className="tier-table">
                      <thead>
                        <tr><th>等級</th><th>累積消費門檻</th><th>訂單折扣</th><th>說明</th></tr>
                      </thead>
                      <tbody>
                        {membership.tiers.map((t) => (
                          <tr key={t.id} className={membership.tier?.id === t.id ? 'is-current' : ''}>
                            <td>
                              {t.name}
                              {membership.tier?.id === t.id && (
                                <span className="tag tag--member" style={{ marginLeft: 8 }}>目前等級</span>
                              )}
                            </td>
                            <td>NT${formatPrice(t.min_spent)}</td>
                            <td>
                              {Number(t.discount_percent) > 0
                                ? `${(100 - Number(t.discount_percent)) / 10} 折`
                                : '－'}
                            </td>
                            <td className="small muted">{t.note}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {membership.used_coupons.length > 0 && (
                <div className="panel">
                  <h2 className="panel__title">已使用的折價券</h2>
                  <div className="coupon-list">
                    {membership.used_coupons.map((c) => <CouponCard key={c.id} coupon={c} />)}
                  </div>
                </div>
              )}
            </>
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
                          <Link to={orderUrl(o)}>{o.order_no}</Link>
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
                          <span className={`tag tag--${
                            o.payment_status === 'paid' ? 'shipped'
                              : o.payment_status === 'failed' ? 'cancelled' : 'pending'
                          }`}>
                            {o.payment_method === 'cod' ? '貨到付款' : PAYMENT_STATUS_TEXT[o.payment_status]}
                          </span>
                          {o.can_retry_payment && (
                            <div style={{ marginTop: 6 }}>
                              <a className="small" style={{ fontWeight: 500 }}
                                 href={checkoutUrl(o)}>
                                前往付款
                              </a>
                            </div>
                          )}
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
