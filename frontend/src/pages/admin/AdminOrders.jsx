import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LOGISTICS_STATUS_TEXT, ORDER_STATUS_TEXT, PAYMENT_STATUS_TEXT, TEMPERATURE_TEXT,
  api, apiUrl, formatDate, formatPrice,
} from '../../api/client'

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'need-ship', label: '待出貨' },
  { key: 'unpaid', label: '未付款' },
  { key: 'shipped', label: '已出貨' },
]

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [filter, setFilter] = useState('')
  const [senderIssues, setSenderIssues] = useState([])

  // 先檢查寄件人資料是否齊全，缺的話直接提醒，不要等到建單失敗才發現
  useEffect(() => {
    api.getSettings().then((s) => {
      const missing = []
      if (!(s.sender_name || '').trim()) missing.push('寄件人姓名')
      if (!/^09\d{8}$/.test((s.sender_cellphone || '').replace(/\D/g, ''))) {
        missing.push('寄件人手機（超商店到店必填，需 09 開頭 10 碼）')
      }
      if (!(s.sender_zipcode || '').trim()) missing.push('寄件人郵遞區號（宅配必填）')
      if ((s.sender_address || '').trim().length < 6) missing.push('寄件人地址（宅配必填）')
      setSenderIssues(missing)
    }).catch(() => {})
  }, [])

  const load = () => {
    setLoading(true)
    api.allOrders().then(setOrders).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const patch = (updated) =>
    setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)))

  const changeStatus = async (order, status) => {
    setErr('')
    try { patch(await api.updateOrderStatus(order.id, status)) } catch (e) { setErr(e.message) }
  }

  const createLogistics = async (order) => {
    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const res = await api.createLogistics(order.id)
      setMsg(
        res.cvs_payment_no
          ? `已建立物流單，寄件代碼 ${res.cvs_payment_no}${res.cvs_validation_no ? `（驗證碼 ${res.cvs_validation_no}）` : ''}`
          : `已建立物流單，託運單號 ${res.booking_note || res.allpay_logistics_id}`,
      )
      setOpenId(order.id)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const syncPayment = async (order) => {
    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const res = await api.syncPayment(order.order_no)
      setMsg(`已向綠界查詢：付款狀態為「${PAYMENT_STATUS_TEXT[res.payment_status] || res.payment_status}」`)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const printLabel = (order) => {
    window.open(apiUrl(`/api/logistics/orders/${order.id}/print`), '_blank', 'width=1000,height=760')
  }

  const visible = orders.filter((o) => {
    if (filter === 'need-ship') {
      return o.logistics_status === 'none' && (o.payment_status === 'paid' || o.payment_method === 'cod')
    }
    if (filter === 'unpaid') return o.payment_method !== 'cod' && o.payment_status !== 'paid'
    if (filter === 'shipped') return ['shipped', 'arrived', 'picked'].includes(o.logistics_status)
    return true
  })

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">訂單與出貨管理</h1>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>重新整理</button>
      </div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      {senderIssues.length > 0 && (
        <div className="alert alert--error">
          <strong>建立物流單前，請先補齊寄件人資料</strong>
          <ul style={{ margin: '8px 0 10px', paddingLeft: 18, listStyle: 'disc' }}>
            {senderIssues.map((m) => <li key={m} style={{ marginBottom: 2 }}>{m}</li>)}
          </ul>
          <Link to="/admin/settings" className="btn btn--outline btn--sm">前往網站設定填寫</Link>
        </div>
      )}

      <div className="filter-bar" style={{ justifyContent: 'flex-start', marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <button type="button" key={f.key} className={`chip${filter === f.key ? ' active' : ''}`}
                  onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      <div className="panel" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading">載入中…</div>
        ) : visible.length ? (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>訂單編號</th><th>收件人</th><th>金額</th>
                  <th>付款</th><th>送貨</th><th>物流</th><th>訂單狀態</th><th>明細</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((o) => {
                  const isCod = o.payment_method === 'cod'
                  const paidOrCod = isCod || o.payment_status === 'paid'
                  return (
                    <Fragment key={o.id}>
                      <tr>
                        <td style={{ fontFamily: 'monospace' }}>
                          {o.order_no}
                          <div className="small muted">{formatDate(o.created_at)}</div>
                        </td>
                        <td>
                          {o.receiver_name}
                          <div className="small muted">{o.receiver_phone}</div>
                        </td>
                        <td>NT${formatPrice(o.total_amount)}</td>
                        <td>
                          <span className={`tag tag--${o.payment_status === 'paid' ? 'shipped' : o.payment_status === 'pending' ? 'pending' : 'cancelled'}`}>
                            {isCod ? '貨到付款' : PAYMENT_STATUS_TEXT[o.payment_status]}
                          </span>
                          <div className="small muted">{o.payment_method_label}</div>
                        </td>
                        <td className="small">
                          {o.shipping_method_label}
                          {o.temperature && o.temperature !== '0001' && (
                            <div className="muted">{TEMPERATURE_TEXT[o.temperature]}</div>
                          )}
                        </td>
                        <td>
                          <span className={`tag tag--${o.logistics_status === 'none' ? 'completed' : o.logistics_status === 'failed' ? 'cancelled' : 'shipped'}`}>
                            {LOGISTICS_STATUS_TEXT[o.logistics_status]}
                          </span>
                        </td>
                        <td>
                          <select className="select" style={{ padding: '5px 8px', fontSize: 13, minWidth: 96 }}
                                  value={o.status} onChange={(e) => changeStatus(o, e.target.value)}>
                            {Object.entries(ORDER_STATUS_TEXT).map(([k, v]) => (
                              <option key={k} value={k}>{v}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <button type="button" className="btn btn--ghost btn--sm"
                                  onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                            {openId === o.id ? '收合' : '展開'}
                          </button>
                        </td>
                      </tr>

                      {openId === o.id && (
                        <tr>
                          <td colSpan="8" style={{ background: 'var(--honey-50)' }}>
                            <div style={{ padding: '8px 0 14px' }}>
                              <div className="ship-grid" style={{ marginBottom: 16 }}>
                                <div>
                                  <div className="ship-label">收件資訊</div>
                                  <div className="small">
                                    {o.cvs_store_name ? (
                                      <>
                                        <strong>{o.cvs_store_name}</strong>（店號 {o.cvs_store_id}）
                                        <div className="muted">{o.cvs_address}</div>
                                      </>
                                    ) : (
                                      <>{o.receiver_zipcode} {o.receiver_address}</>
                                    )}
                                  </div>
                                </div>
                                {o.note && (
                                  <div>
                                    <div className="ship-label">訂單備註</div>
                                    <div className="small">{o.note}</div>
                                  </div>
                                )}
                                {o.ecpay_trade_no && (
                                  <div>
                                    <div className="ship-label">綠界交易編號</div>
                                    <div className="small" style={{ fontFamily: 'monospace' }}>{o.ecpay_trade_no}</div>
                                  </div>
                                )}
                                {o.payment_no && (
                                  <div>
                                    <div className="ship-label">
                                      {o.payment_method === 'atm' ? '虛擬帳號' : '繳費代碼'}
                                    </div>
                                    <div className="small" style={{ fontFamily: 'monospace' }}>
                                      {o.payment_bank_code ? `(${o.payment_bank_code}) ` : ''}{o.payment_no}
                                    </div>
                                  </div>
                                )}
                              </div>

                              <table className="table" style={{ minWidth: 0, background: 'var(--white)' }}>
                                <thead><tr><th>商品</th><th>單價</th><th>數量</th><th>小計</th></tr></thead>
                                <tbody>
                                  {o.items.map((i) => (
                                    <tr key={i.id}>
                                      <td>{i.product_name}</td>
                                      <td>NT${formatPrice(i.unit_price)}</td>
                                      <td>{i.quantity}</td>
                                      <td>NT${formatPrice(i.unit_price * i.quantity)}</td>
                                    </tr>
                                  ))}
                                  <tr>
                                    <td colSpan="3" style={{ textAlign: 'right' }} className="muted">運費</td>
                                    <td>NT${formatPrice(o.shipping_fee)}</td>
                                  </tr>
                                </tbody>
                              </table>

                              {/* 出貨操作 */}
                              <div className="ship-box">
                                {o.cvs_payment_no || o.booking_note ? (
                                  <>
                                    <div className="ship-grid">
                                      {o.cvs_payment_no && (
                                        <div>
                                          <div className="ship-label">寄件代碼（超商機台輸入）</div>
                                          <div className="ship-code">{o.cvs_payment_no}</div>
                                        </div>
                                      )}
                                      {o.cvs_validation_no && (
                                        <div>
                                          <div className="ship-label">驗證碼</div>
                                          <div className="ship-code">{o.cvs_validation_no}</div>
                                        </div>
                                      )}
                                      {o.booking_note && (
                                        <div>
                                          <div className="ship-label">宅配託運單號</div>
                                          <div className="ship-code">{o.booking_note}</div>
                                        </div>
                                      )}
                                      <div>
                                        <div className="ship-label">綠界物流編號</div>
                                        <div className="small" style={{ fontFamily: 'monospace', paddingTop: 6 }}>
                                          {o.allpay_logistics_id}
                                        </div>
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                                      <button type="button" className="btn btn--primary btn--sm"
                                              onClick={() => printLabel(o)}>
                                        列印託運單
                                      </button>
                                      <button type="button" className="btn btn--ghost btn--sm"
                                              onClick={() => navigator.clipboard?.writeText(o.cvs_payment_no || o.booking_note || '')}>
                                        複製代碼
                                      </button>
                                    </div>
                                    <p className="small muted" style={{ margin: '12px 0 0' }}>
                                      {o.cvs_payment_no
                                        ? '把包裹拿到超商，在機台輸入寄件代碼列印單據，貼上後交給店員即可。運費由綠界從你的帳戶結算。'
                                        : '宅配可線上列印託運單，或通知宅配員到府收件。'}
                                    </p>
                                  </>
                                ) : (
                                  <>
                                    <div className="small" style={{ marginBottom: 12 }}>
                                      {paidOrCod
                                        ? '這筆訂單可以出貨了。按下按鈕後系統會向綠界建立物流單，並取得寄件代碼。'
                                        : '這筆訂單尚未付款，建議確認款項後再建立物流單。'}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button type="button" className="btn btn--primary btn--sm"
                                              disabled={busyId === o.id}
                                              onClick={() => createLogistics(o)}>
                                        {busyId === o.id ? '建立中…' : '建立物流單並取得寄件代碼'}
                                      </button>
                                      {!isCod && o.payment_status !== 'paid' && (
                                        <button type="button" className="btn btn--outline btn--sm"
                                                disabled={busyId === o.id}
                                                onClick={() => syncPayment(o)}>
                                          向綠界查詢付款狀態
                                        </button>
                                      )}
                                    </div>
                                    {o.logistics_message && (
                                      <p className="small" style={{ color: 'var(--danger)', margin: '12px 0 0' }}>
                                        上次建立結果：{o.logistics_message}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state__title">沒有符合條件的訂單</div>
          </div>
        )}
      </div>
    </>
  )
}
