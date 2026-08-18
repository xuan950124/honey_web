import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TEMPERATURE_TEXT, api, formatPrice, orderUrl } from '../api/client'
import CouponCard from '../components/CouponCard'
import Placeholder from '../components/Placeholder'
import StorePicker from '../components/StorePicker'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useSettings } from '../context/SettingsContext'

const TEMPERATURES = ['0001', '0002', '0003']

export default function Cart() {
  const {
    items, updateQty, remove, clear, syncStock, hasStockIssue, limitOf,
    total: subtotal,
  } = useCart()
  const { user } = useAuth()
  const { settings } = useSettings()
  const navigate = useNavigate()
  const [stockNotices, setStockNotices] = useState([])
  const [notice, setNotice] = useState('')

  const [options, setOptions] = useState(null)
  const [shippingMethod, setShippingMethod] = useState('cvs_unimart_c2c')
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [temperature, setTemperature] = useState('0001')
  const [store, setStore] = useState({})
  const [quote, setQuote] = useState(null)

  // 折價券
  const [coupons, setCoupons] = useState([])
  const [couponCode, setCouponCode] = useState('')

  const [form, setForm] = useState({
    receiver_name: '', receiver_phone: '', receiver_address: '', receiver_zipcode: '', note: '',
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    api.checkoutOptions().then(setOptions).catch((e) => setError(e.message))
    api.policies()
      .then((p) => setNotice(p.policy_checkout_notice || ''))
      .catch(() => {})
  }, [])

  // 進到購物車就跟後端要一次最新庫存。
  // 購物車存在 localStorage，可能是好幾天前加入的，那時的庫存早就不準了。
  // 與其讓買家填完一整頁資料才在送出時被擋，不如現在就先講清楚。
  useEffect(() => {
    let cancelled = false
    api.listProducts()
      .then((products) => {
        if (cancelled) return
        const notices = syncStock(products)
        if (notices.length) setStockNotices(notices)
      })
      .catch(() => {})   // 拿不到就算了，後端建立訂單時還會再擋一次
    return () => { cancelled = true }
  }, [syncStock])

  // 登入後載入可用的折價券
  useEffect(() => {
    if (!user) return setCoupons([])
    api.membership().then((m) => setCoupons(m.coupons || [])).catch(() => setCoupons([]))
  }, [user])

  useEffect(() => {
    if (!user) return
    setForm((f) => ({
      ...f,
      receiver_name: f.receiver_name || user.name || '',
      receiver_phone: f.receiver_phone || user.phone || '',
      receiver_address: f.receiver_address || user.address || '',
    }))
  }, [user])

  const selectedShipping = useMemo(
    () => options?.shipping.find((s) => s.value === shippingMethod),
    [options, shippingMethod],
  )
  const isCvs = selectedShipping?.kind === 'cvs'
  const isCod = paymentMethod === 'cod'

  // 送貨方式改變時，若目前的付款方式不支援就自動切回信用卡
  useEffect(() => {
    if (isCod && selectedShipping && !selectedShipping.supports_cod) setPaymentMethod('credit')
    if (selectedShipping && !selectedShipping.supports_temperature) setTemperature('0001')
  }, [selectedShipping, isCod])

  // 試算運費
  useEffect(() => {
    if (!items.length) return setQuote(null)
    api
      .quote({
        subtotal,
        shipping_method: shippingMethod,
        payment_method: paymentMethod,
        temperature,
        coupon_code: couponCode || null,
      })
      .then(setQuote)
      .catch(() => setQuote(null))
  }, [subtotal, shippingMethod, paymentMethod, temperature, couponCode, items.length])

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (!items.length) return setError('購物車是空的')
    if (hasStockIssue) {
      const over = items.filter((i) => i.quantity > limitOf(i))
      return setError(
        `庫存不足：${over.map((i) => `${i.name}（只剩 ${limitOf(i)} 組）`).join('、')}，請調整數量後再結帳`,
      )
    }
    if (isCvs && !store.cvs_store_id) return setError('請先選擇取貨門市')
    if (!isCvs && (form.receiver_address || '').trim().length < 6) {
      return setError('請填寫完整的收件地址')
    }
    if (!/^09\d{8}$/.test((form.receiver_phone || '').replace(/\D/g, ''))) {
      return setError('請填寫正確的手機號碼（09 開頭共 10 碼），超商與宅配都需要簡訊通知')
    }

    setSubmitting(true)
    try {
      const payload = {
        receiver_name: form.receiver_name,
        receiver_phone: form.receiver_phone.replace(/\D/g, ''),
        note: form.note || null,
        items: items.map((i) => ({ product_id: i.id, quantity: i.quantity })),
        shipping_method: shippingMethod,
        payment_method: paymentMethod,
        temperature,
        coupon_code: couponCode || null,
        ...(isCvs
          ? store
          : { receiver_address: form.receiver_address, receiver_zipcode: form.receiver_zipcode || null }),
      }
      const res = await api.createOrder(payload)
      clear()
      if (res.payment_url) {
        // 整頁導向綠界付款頁（綠界規定不可用 iframe）
        window.location.href = res.payment_url
      } else {
        // 帶上存取碼，訪客之後才回得來看自己的訂單
        navigate(orderUrl(res.order), { replace: true })
      }
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  if (!items.length) {
    return (
      <>
        <section className="page-hero">
          <div className="container"><h1 className="page-hero__title">購物車</h1></div>
        </section>
        <section className="section">
          <div className="container">
            <div className="empty-state">
              <div className="empty-state__title">購物車還是空的</div>
              <p>去看看有哪些蜂蜜吧</p>
              <Link to="/products" className="btn btn--primary" style={{ marginTop: 18 }}>開始選購</Link>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <>
      <section className="page-hero">
        <div className="container"><h1 className="page-hero__title">購物車與結帳</h1></div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cart-layout">
            <div>
              {/* 商品明細 */}
              <div className="panel">
                <h2 className="panel__title">商品明細（{items.length} 項）</h2>

                {stockNotices.length > 0 && (
                  <div className="alert alert--info">
                    <strong>購物車已依最新庫存調整</strong>
                    <ul style={{ margin: '8px 0 0', paddingLeft: 18, listStyle: 'disc' }}>
                      {stockNotices.map((n) => <li key={n} className="small">{n}</li>)}
                    </ul>
                  </div>
                )}

                {items.map((i) => {
                  const limit = limitOf(i)
                  const capped = Number.isFinite(limit) && i.quantity >= limit
                  const over = Number.isFinite(limit) && i.quantity > limit
                  return (
                    <div className="cart-line" key={i.id}>
                      <Placeholder src={i.image_url} ratio="1x1" alt={i.name} hint="" />
                      <div>
                        <Link to={`/products/${i.id}`} style={{ fontWeight: 500, color: 'var(--honey-900)' }}>
                          {i.name}
                        </Link>
                        {i.spec && <div className="small muted">{i.spec}</div>}
                        <div className="price" style={{ fontSize: 16, marginTop: 6 }}>
                          <span className="price__cur">NT$</span>{formatPrice(i.price)}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                          <div className="qty">
                            <button type="button" disabled={i.quantity <= 1}
                                    onClick={() => updateQty(i.id, i.quantity - 1)}>−</button>
                            <input
                              type="number" min="1"
                              max={Number.isFinite(limit) ? limit : undefined}
                              value={i.quantity}
                              onChange={(e) => updateQty(i.id, Number(e.target.value) || 1)}
                            />
                            <button type="button" disabled={capped}
                                    onClick={() => updateQty(i.id, i.quantity + 1)}>＋</button>
                          </div>
                          <button type="button" className="btn btn--ghost btn--sm" onClick={() => remove(i.id)}>
                            移除
                          </button>
                        </div>
                        {Number.isFinite(limit) && (
                          <div className="small" style={{ marginTop: 6, color: over ? 'var(--danger)' : 'var(--ink-soft)' }}>
                            {over
                              ? `庫存只剩 ${limit} 組，請減少數量`
                              : capped
                                ? `已達庫存上限（剩 ${limit} 組）`
                                : `庫存剩 ${limit} 組`}
                          </div>
                        )}
                      </div>
                      <div className="price" style={{ fontSize: 18 }}>
                        <span className="price__cur">NT$</span>{formatPrice(i.price * i.quantity)}
                      </div>
                    </div>
                  )
                })}
              </div>

              <form id="checkout-form" onSubmit={submit}>
                {/* 送貨方式 */}
                <div className="panel">
                  <h2 className="panel__title">送貨方式</h2>
                  {!options ? (
                    <div className="loading" style={{ padding: 20 }}>載入中…</div>
                  ) : (
                    <>
                      <div className="option-grid">
                        {options.shipping.map((s) => (
                          <label key={s.value} className={`option${shippingMethod === s.value ? ' active' : ''}`}>
                            <input type="radio" name="shipping" value={s.value}
                                   checked={shippingMethod === s.value}
                                   onChange={() => setShippingMethod(s.value)} />
                            <div>
                              <div className="option__title">
                                {s.label}
                                {s.is_cheapest && <span className="option__flag">最省運費</span>}
                              </div>
                              <div className="option__meta">
                                運費 NT${formatPrice(s.fee)}
                                {s.note ? `．${s.note}` : ''}
                              </div>
                            </div>
                          </label>
                        ))}
                      </div>

                      {isCvs && (
                        <div style={{ marginTop: 18 }}>
                          <StorePicker
                            shippingMethod={shippingMethod}
                            isCollection={isCod}
                            store={store}
                            onSelect={setStore}
                            backendOrigin={options.backend_base_url}
                          />
                        </div>
                      )}

                      {selectedShipping?.supports_temperature && (
                        <div className="field" style={{ marginTop: 18, marginBottom: 0 }}>
                          <label>配送溫層</label>
                          <div className="chip-row">
                            {TEMPERATURES.map((t) => (
                              <button type="button" key={t}
                                      className={`chip${temperature === t ? ' active' : ''}`}
                                      onClick={() => setTemperature(t)}>
                                {TEMPERATURE_TEXT[t]}
                              </button>
                            ))}
                          </div>
                          <div className="field__hint">冷藏／冷凍運費較高，實際金額請看右側訂單摘要</div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* 付款方式 */}
                <div className="panel">
                  <h2 className="panel__title">付款方式</h2>
                  <div className="option-grid">
                    {(options?.payment || []).map((p) => {
                      const disabled = p.value === 'cod' && selectedShipping && !selectedShipping.supports_cod
                      return (
                        <label key={p.value}
                               className={`option${paymentMethod === p.value ? ' active' : ''}${disabled ? ' disabled' : ''}`}>
                          <input type="radio" name="payment" value={p.value} disabled={disabled}
                                 checked={paymentMethod === p.value}
                                 onChange={() => setPaymentMethod(p.value)} />
                          <div>
                            <div className="option__title">{p.label}</div>
                            <div className="option__meta">
                              {disabled ? '此送貨方式不支援' : p.note}
                            </div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                  {options?.ecpay_env !== 'production' && (
                    <div className="alert alert--info" style={{ marginTop: 16, marginBottom: 0 }}>
                      目前是綠界<strong>測試環境</strong>，不會真的扣款。
                      測試卡號 4311-9511-1111-1111，安全碼任意三碼，
                      有效期限填未來日期，3D 驗證碼 1234。
                    </div>
                  )}
                </div>

                {/* 折價券 */}
                {user && coupons.length > 0 && (
                  <div className="panel">
                    <h2 className="panel__title">使用折價券</h2>
                    <div className="coupon-list">
                      {coupons.map((cp) => (
                        <CouponCard
                          key={cp.id}
                          coupon={cp}
                          selected={couponCode === cp.code}
                          onSelect={(picked) =>
                            setCouponCode(couponCode === picked.code ? '' : picked.code)
                          }
                        />
                      ))}
                    </div>
                    {couponCode && (
                      <button type="button" className="btn btn--ghost btn--sm"
                              style={{ marginTop: 12 }} onClick={() => setCouponCode('')}>
                        不使用折價券
                      </button>
                    )}
                    {quote?.coupon_error && (
                      <div className="alert alert--error" style={{ marginTop: 12, marginBottom: 0 }}>
                        {quote.coupon_error}
                      </div>
                    )}
                  </div>
                )}

                {!user && (
                  <div className="panel">
                    <h2 className="panel__title">會員優惠</h2>
                    <p className="small muted" style={{ marginBottom: 12 }}>
                      登入後可使用折價券，消費也會累積成為升級與領券的依據。
                    </p>
                    <Link to="/login" className="btn btn--outline btn--sm">前往登入</Link>
                  </div>
                )}

                {/* 收件資料 */}
                <div className="panel">
                  <h2 className="panel__title">收件資料</h2>
                  {error && <div className="alert alert--error">{error}</div>}
                  {!user && (
                    <div className="alert alert--info">
                      您目前未登入，仍可直接下單。
                      <Link to="/login" style={{ textDecoration: 'underline' }}>登入</Link>
                      後可於會員中心追蹤訂單。
                    </div>
                  )}

                  <div className="form-row">
                    <div className="field">
                      <label htmlFor="receiver_name">收件人姓名<span className="req">*</span></label>
                      <input id="receiver_name" className="input" name="receiver_name" required
                             value={form.receiver_name} onChange={change} />
                      <div className="field__hint">請填真實姓名，超商取貨需與證件相符</div>
                    </div>
                    <div className="field">
                      <label htmlFor="receiver_phone">收件人手機<span className="req">*</span></label>
                      <input id="receiver_phone" className="input" name="receiver_phone" required
                             placeholder="09xxxxxxxx" value={form.receiver_phone} onChange={change} />
                      <div className="field__hint">到貨通知簡訊會寄到這支號碼</div>
                    </div>
                  </div>

                  {!isCvs && (
                    <div className="form-row">
                      <div className="field">
                        <label htmlFor="receiver_zipcode">郵遞區號</label>
                        <input id="receiver_zipcode" className="input" name="receiver_zipcode"
                               placeholder="例：733" value={form.receiver_zipcode} onChange={change} />
                        <div className="field__hint">留空會自動從地址開頭判斷</div>
                      </div>
                      <div className="field">
                        <label htmlFor="receiver_address">收件地址<span className="req">*</span></label>
                        <input id="receiver_address" className="input" name="receiver_address" required
                               placeholder="請填寫完整地址" value={form.receiver_address} onChange={change} />
                      </div>
                    </div>
                  )}

                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="note">訂單備註</label>
                    <textarea id="note" className="textarea" name="note" value={form.note} onChange={change}
                              placeholder="例如：需要開立三聯式發票（抬頭／統編）、指定到貨時段等" />
                  </div>
                </div>
              </form>
            </div>

            {/* 訂單摘要 */}
            <aside className="summary">
              <h3 className="panel__title" style={{ marginBottom: 14 }}>訂單摘要</h3>
              <div className="summary__row">
                <span className="muted">商品小計</span>
                <span>NT${formatPrice(subtotal)}</span>
              </div>
              {quote?.member_discount > 0 && (
                <div className="summary__row">
                  <span className="muted">
                    會員折扣
                    {quote.member_tier_name ? `（${quote.member_tier_name}）` : ''}
                  </span>
                  <span style={{ color: 'var(--success)' }}>
                    −NT${formatPrice(quote.member_discount)}
                  </span>
                </div>
              )}
              {quote?.coupon_discount > 0 && (
                <div className="summary__row">
                  <span className="muted">折價券</span>
                  <span style={{ color: 'var(--success)' }}>
                    −NT${formatPrice(quote.coupon_discount)}
                  </span>
                </div>
              )}
              <div className="summary__row">
                <span className="muted">運費</span>
                <span>
                  {quote
                    ? quote.shipping_fee === 0
                      ? <span style={{ color: 'var(--success)' }}>免運</span>
                      : `NT$${formatPrice(quote.shipping_fee)}`
                    : '計算中…'}
                </span>
              </div>
              {quote?.cod_fee > 0 && (
                <div className="summary__row">
                  <span className="muted">貨到付款手續費</span>
                  <span>NT${formatPrice(quote.cod_fee)}</span>
                </div>
              )}
              {quote?.free_shipping_threshold > 0 && !quote.is_free_shipping && (
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  再買 NT${formatPrice(quote.free_shipping_threshold - subtotal)} 即可免運
                </p>
              )}
              <div className="summary__total">
                <span>應付總額</span>
                <span className="price">
                  <span className="price__cur">NT$</span>
                  {formatPrice(quote ? quote.total : subtotal)}
                </span>
              </div>

              {/*
                退換貨告知。法規要求「必須在消費者下單前明確告知」才能排除七天猶豫期，
                只放在頁尾的連結裡不算數，所以放在送出按鈕的正上方。
              */}
              {notice && (
                <div className="checkout-notice">
                  <strong>訂購前請確認</strong>
                  <p>{notice}</p>
                  <Link to="/refund" target="_blank">完整退換貨政策</Link>
                </div>
              )}

              <button type="submit" form="checkout-form" className="btn btn--primary btn--block"
                      style={{ marginTop: 16 }} disabled={submitting || hasStockIssue}>
                {submitting ? '處理中…' : hasStockIssue ? '請先調整數量' : isCod ? '送出訂單' : '前往付款'}
              </button>
              <p className="small muted text-center" style={{ marginTop: 12, marginBottom: 0 }}>
                {hasStockIssue
                  ? '有商品超過庫存，請往上調整數量'
                  : isCod
                    ? '送出後我們會與您確認明細，取貨時再付款'
                    : '將導向綠界付款頁，卡號不會經過本站'}
              </p>

              {settings.line_id && (
                <p className="small muted text-center" style={{ marginTop: 14, marginBottom: 0 }}>
                  有問題可加 LINE：{settings.line_id}
                </p>
              )}
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}
