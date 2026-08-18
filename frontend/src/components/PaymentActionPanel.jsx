import { useEffect, useState } from 'react'
import { api, checkoutUrl, formatPrice } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'

/**
 * 未付款／付款失敗的處理區塊。
 *
 * 買家最容易卡住的三個地方：信用卡被拒絕、ATM 忘記轉帳、超商代碼過期。
 * 這三種情況都不該叫買家重新下單 —— 重下單會丟掉折價券，庫存也會被扣兩次。
 * 所以這裡一律走「同一筆訂單重新付款」，需要的話還能換一種付款方式。
 */

const METHODS = [
  { value: 'credit', label: '信用卡', note: '最快，付完立刻確認' },
  { value: 'atm', label: 'ATM 轉帳', note: '取得虛擬帳號後 3 天內轉帳' },
  { value: 'cvs_code', label: '超商代碼繳費', note: '拿代碼到超商機台繳費' },
]

/** 把剩餘時間講成人話：「還有 2 天 5 小時」比一串時間戳有用得多。 */
function remainingText(deadline) {
  if (!deadline) return null
  const ms = new Date(deadline).getTime() - Date.now()
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return { expired: true, text: '已超過付款期限' }

  const hours = Math.floor(ms / 3600000)
  const days = Math.floor(hours / 24)
  if (days >= 1) return { expired: false, text: `還有 ${days} 天 ${hours % 24} 小時` }
  if (hours >= 1) return { expired: false, text: `只剩 ${hours} 小時`, urgent: true }
  return { expired: false, text: `只剩 ${Math.max(1, Math.floor(ms / 60000))} 分鐘`, urgent: true }
}

export default function PaymentActionPanel({ order, onUpdated }) {
  const { user } = useAuth()
  const { settings } = useSettings()
  const [switching, setSwitching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [, forceTick] = useState(0)

  // 每分鐘重算一次倒數，不然停在頁面上時間會停格
  useEffect(() => {
    const t = setInterval(() => forceTick((v) => v + 1), 60000)
    return () => clearInterval(t)
  }, [])

  if (!order || order.payment_method === 'cod') return null
  if (order.payment_status === 'paid' || order.payment_status === 'refunded') return null

  const cancelled = order.status === 'cancelled'
  const failed = order.payment_status === 'failed'
  const waiting = order.payment_status === 'pending'   // ATM／超商代碼已取號
  const left = cancelled ? null : remainingText(order.payment_deadline)
  const expired = left?.expired
  const isOwner = Boolean(user && order.can_retry_payment)

  const pay = () => {
    window.location.href = checkoutUrl(order)
  }

  const switchTo = async (method) => {
    setErr(''); setBusy(true)
    try {
      await api.changePaymentMethod(order.order_no, method, order.access_token)
      // 換完直接送去付款，少一次點擊
      pay()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  const cancel = async () => {
    setErr(''); setBusy(true)
    try {
      const updated = await api.cancelOrder(order.order_no)
      onUpdated?.(updated)
      setConfirmCancel(false)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (cancelled) {
    return (
      <div className="pay-panel pay-panel--muted">
        <div className="pay-panel__head">
          <span className="pay-panel__badge pay-panel__badge--muted">訂單已取消</span>
        </div>
        <p className="pay-panel__lead">
          {order.cancel_reason || '這筆訂單已經取消。'}
          {' '}商品已經放回庫存，沒有向你收取任何費用。
        </p>
        <a className="btn btn--outline" href="/products">重新選購</a>
      </div>
    )
  }

  return (
    <div className={`pay-panel${failed || expired ? ' pay-panel--danger' : ''}`}>
      <div className="pay-panel__head">
        <span className={`pay-panel__badge${failed || expired ? ' pay-panel__badge--danger' : ''}`}>
          {expired ? '已逾期' : failed ? '付款失敗' : waiting ? '等待繳費' : '尚未付款'}
        </span>
        {left && !expired && (
          <span className={`pay-panel__timer${left.urgent ? ' is-urgent' : ''}`}>{left.text}</span>
        )}
      </div>

      <div className="pay-panel__amount">
        應付金額 <strong>NT${formatPrice(order.total_amount)}</strong>
      </div>

      <p className="pay-panel__lead">
        {expired ? (
          <>這筆訂單已經超過付款期限，系統會自動取消並把商品放回庫存。想繼續購買請重新下單，
          或直接與我們聯絡由我們協助保留。</>
        ) : failed ? (
          <>
            付款沒有成功
            {order.payment_message ? <>：<strong>{order.payment_message}</strong></> : '。'}
            {' '}常見原因是額度不足、卡片未開通網路交易，或是 3D 驗證簡訊沒收到。
            可以再刷一次，或換一種付款方式 —— <strong>訂單和折扣都還在，不需要重新下單</strong>。
          </>
        ) : waiting ? (
          <>已經幫你取號了，請依下方資訊在期限內完成繳費。繳費後系統會自動更新，我們才會安排出貨。</>
        ) : (
          <>這筆訂單還沒完成付款，我們會先幫你保留商品。完成付款後才會安排出貨。</>
        )}
      </p>

      {err && <div className="alert alert--error" style={{ marginBottom: 14 }}>{err}</div>}

      {!expired && (
        <>
          <div className="pay-panel__actions">
            <button type="button" className="btn btn--primary" onClick={pay} disabled={busy}>
              {waiting ? '重新取號並前往付款' : failed ? '再付款一次' : '立即前往付款'}
            </button>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => setSwitching((v) => !v)}
              disabled={busy}
            >
              {switching ? '收起' : '改用其他付款方式'}
            </button>
          </div>

          {switching && (
            <div className="pay-methods">
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                選一種新的付款方式，我們會直接帶你去付款。金額與折扣都不變。
              </p>
              {METHODS.filter((m) => m.value !== order.payment_method).map((m) => (
                <button
                  type="button"
                  key={m.value}
                  className="pay-methods__item"
                  onClick={() => switchTo(m.value)}
                  disabled={busy}
                >
                  <span className="pay-methods__label">{m.label}</span>
                  <span className="pay-methods__note">{m.note}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {isOwner && (
        <div className="pay-panel__foot">
          {confirmCancel ? (
            <>
              <span className="small">確定要取消這筆訂單嗎？取消後無法復原。</span>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={cancel}>
                {busy ? '處理中…' : '確定取消'}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmCancel(false)}>
                再想想
              </button>
            </>
          ) : (
            <button type="button" className="pay-panel__link" onClick={() => setConfirmCancel(true)}>
              不想買了，取消這筆訂單
            </button>
          )}
        </div>
      )}

      {(settings.line_id || settings.contact_phone) && (
        <p className="small muted" style={{ margin: '14px 0 0' }}>
          付款有問題可以直接找我們
          {settings.line_id ? `：LINE ${settings.line_id}` : ''}
          {settings.contact_phone ? `　電話 ${settings.contact_phone}` : ''}
        </p>
      )}
    </div>
  )
}
