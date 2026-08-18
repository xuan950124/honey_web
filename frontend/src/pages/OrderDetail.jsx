import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  LOGISTICS_STATUS_TEXT, ORDER_STATUS_TEXT, TEMPERATURE_TEXT,
  api, formatDate, formatPrice, paymentTextFor, paymentToneFor,
} from '../api/client'
import PaymentActionPanel from '../components/PaymentActionPanel'
import { useSettings } from '../context/SettingsContext'

/** 訂單完成頁。付款流程結束後綠界會把買家導回這裡。 */
export default function OrderDetail() {
  const { orderNo } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') || ''
  const [order, setOrder] = useState(null)
  const [error, setError] = useState('')
  const { settings } = useSettings()

  useEffect(() => {
    window.scrollTo(0, 0)
    // 訪客要憑網址上的存取碼才看得到；會員與工作人員則靠登入身分
    api.getOrderByNo(orderNo, token).then(setOrder).catch((e) => setError(e.message))
  }, [orderNo, token])

  if (error) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__title">{error}</div>
          <Link to="/" className="btn btn--outline" style={{ marginTop: 16 }}>回到首頁</Link>
        </div>
      </div>
    )
  }
  if (!order) return <div className="loading">載入中…</div>

  const paid = order.payment_status === 'paid'
  const waiting = order.payment_status === 'pending'
  const failed = order.payment_status === 'failed'
  const isCod = order.payment_method === 'cod'
  const cancelled = order.status === 'cancelled'

  // 標題要先看訂單走到哪，再看付款狀態。
  // 反過來的話，一筆已完成但沒註記收款的訂單會顯示「等待付款」，
  // 客人東西都收到了還被叫去付錢。
  const heading = cancelled
    ? '訂單已取消'
    : order.status === 'completed'
      ? '訂單已完成，謝謝你的支持'
      : order.status === 'shipped'
        ? '商品已出貨'
        : paid
          ? '付款完成，感謝您的訂購'
          : isCod
            ? '訂單已成立'
            : failed
              ? '訂單已成立，但付款沒有完成'
              : waiting
                ? '訂單已成立，等待繳費'
                : '訂單已成立，等待付款'

  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="panel text-center" style={{ marginBottom: 22 }}>
          <h1 style={{ fontSize: 26, color: 'var(--honey-900)', marginBottom: 10 }}>
            {heading}
          </h1>
          <p className="muted" style={{ marginBottom: 6 }}>
            訂單編號 <strong style={{ color: 'var(--honey-700)', fontFamily: 'monospace' }}>{order.order_no}</strong>
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            <span className={`tag tag--${order.status}`}>{ORDER_STATUS_TEXT[order.status]}</span>
            <span className={`tag tag--${paymentToneFor(order)}`}>
              {paymentTextFor(order)}
            </span>
            {order.logistics_status !== 'none' && (
              <span className="tag tag--paid">{LOGISTICS_STATUS_TEXT[order.logistics_status]}</span>
            )}
          </div>
        </div>

        {/* 未付款／付款失敗的處理區，刻意排在訂單內容前面 —— 這是買家現在最該做的事 */}
        <PaymentActionPanel order={order} onUpdated={setOrder} />

        {waiting && order.payment_no && (
          <div className="panel">
            <h2 className="panel__title">繳費資訊</h2>
            <table className="spec-table">
              <tbody>
                {order.payment_bank_code && (
                  <tr><th>銀行代碼</th><td style={{ fontFamily: 'monospace', fontSize: 16 }}>{order.payment_bank_code}</td></tr>
                )}
                <tr>
                  <th>{order.payment_method === 'atm' ? '虛擬帳號' : '繳費代碼'}</th>
                  <td style={{ fontFamily: 'monospace', fontSize: 18, color: 'var(--honey-700)', fontWeight: 600 }}>
                    {order.payment_no}
                  </td>
                </tr>
                {order.payment_expire_date && (
                  <tr><th>繳費期限</th><td>{order.payment_expire_date}</td></tr>
                )}
                <tr><th>應繳金額</th><td>NT${formatPrice(order.total_amount)}</td></tr>
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 14, marginBottom: 0 }}>
              完成繳費後系統會自動更新訂單狀態，我們才會安排出貨。
            </p>
          </div>
        )}

        <div className="panel">
          <h2 className="panel__title">訂單內容</h2>
          <table className="table" style={{ minWidth: 0 }}>
            <thead><tr><th>商品</th><th>單價</th><th>數量</th><th>小計</th></tr></thead>
            <tbody>
              {order.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.product_name}</td>
                  <td>NT${formatPrice(i.unit_price)}</td>
                  <td>{i.quantity}</td>
                  <td>NT${formatPrice(i.unit_price * i.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="summary__row" style={{ marginTop: 12 }}>
            <span className="muted">商品小計</span><span>NT${formatPrice(order.subtotal)}</span>
          </div>
          {Number(order.member_discount) > 0 && (
            <div className="summary__row">
              <span className="muted">會員折扣</span>
              <span style={{ color: 'var(--success)' }}>−NT${formatPrice(order.member_discount)}</span>
            </div>
          )}
          {Number(order.coupon_discount) > 0 && (
            <div className="summary__row">
              <span className="muted">折價券{order.coupon_code ? `（${order.coupon_code}）` : ''}</span>
              <span style={{ color: 'var(--success)' }}>−NT${formatPrice(order.coupon_discount)}</span>
            </div>
          )}
          <div className="summary__row">
            <span className="muted">運費</span>
            <span>{Number(order.shipping_fee) === 0 ? '免運' : `NT$${formatPrice(order.shipping_fee)}`}</span>
          </div>
          <div className="summary__total">
            <span>總計</span>
            <span className="price"><span className="price__cur">NT$</span>{formatPrice(order.total_amount)}</span>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel__title">配送資訊</h2>
          <table className="spec-table">
            <tbody>
              <tr><th>送貨方式</th><td>{order.shipping_method_label}</td></tr>
              {order.cvs_store_name && (
                <tr>
                  <th>取貨門市</th>
                  <td>
                    {order.cvs_store_name}
                    <div className="small muted">{order.cvs_address}</div>
                  </td>
                </tr>
              )}
              {!order.cvs_store_name && (
                <tr><th>收件地址</th><td>{order.receiver_zipcode} {order.receiver_address}</td></tr>
              )}
              {order.temperature && order.temperature !== '0001' && (
                <tr><th>配送溫層</th><td>{TEMPERATURE_TEXT[order.temperature]}</td></tr>
              )}
              <tr><th>收件人</th><td>{order.receiver_name}．{order.receiver_phone}</td></tr>
              <tr><th>付款方式</th><td>{order.payment_method_label}</td></tr>
              {order.booking_note && <tr><th>宅配單號</th><td style={{ fontFamily: 'monospace' }}>{order.booking_note}</td></tr>}
              {order.logistics_message && <tr><th>物流狀態</th><td>{order.logistics_message}</td></tr>}
              {order.note && <tr><th>備註</th><td>{order.note}</td></tr>}
              <tr><th>下單時間</th><td>{formatDate(order.created_at)}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/products" className="btn btn--outline">繼續選購</Link>
          <Link to="/member" className="btn btn--ghost">我的訂單</Link>
        </div>

        {settings.line_id && (
          <p className="small muted text-center" style={{ marginTop: 22 }}>
            訂單有任何問題，歡迎加 LINE {settings.line_id}
            {settings.contact_phone ? ` 或來電 ${settings.contact_phone}` : ''}
          </p>
        )}
      </div>
    </section>
  )
}
