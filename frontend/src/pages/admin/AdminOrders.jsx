import { Fragment, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  LOGISTICS_STATUS_TEXT, ORDER_STATUS_TEXT, PAYMENT_STATUS_TEXT, TEMPERATURE_TEXT,
  api, apiUrl, formatDate, formatPrice,
} from '../../api/client'

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'need-ship', label: '待出貨' },
  { key: 'unpaid', label: '待付款' },
  { key: 'overdue', label: '逾期未付款' },
  { key: 'mismatch', label: '帳沒對上' },
  { key: 'shipped', label: '已出貨' },
]

/** 未付款且尚未取消的訂單（貨到付款不算，那本來就是取貨才收錢）。 */
const isUnpaid = (o) =>
  o.payment_method !== 'cod' && o.payment_status !== 'paid' && o.status !== 'cancelled'

/** 已經超過繳費期限，錢多半收不到了，庫存卻還被卡著。 */
const isOverdue = (o) =>
  isUnpaid(o) && o.payment_deadline && new Date(o.payment_deadline).getTime() < Date.now()

/**
 * 帳沒對上：訂單已經出貨或完成，付款狀態卻還是未付款。
 *
 * 通常是改狀態時沒有勾「同時註記已收款」。
 * 這種訂單客人看了會困惑（東西收到了，網站卻說沒付錢），
 * 你的業績統計也會少算，所以要能一眼找出來。
 */
const isMismatch = (o) =>
  ['shipped', 'completed'].includes(o.status)
  && o.payment_status !== 'paid'
  && o.payment_status !== 'refunded'

export default function AdminOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [openId, setOpenId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [sweeping, setSweeping] = useState(false)
  // 綠界建單失敗時的結構化說明（標題 + 處理步驟）
  const [help, setHelp] = useState(null)
  // 把未收款的訂單標成出貨／完成時，先跳出來確認的那一筆
  const [pendingStatus, setPendingStatus] = useState(null)
  const [filter, setFilter] = useState('')
  const [senderIssues, setSenderIssues] = useState([])
  // 退款面板：{ order, plan, amount, note, mode }
  const [refund, setRefund] = useState(null)

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

  const changeStatus = async (order, status, markPaid = false) => {
    setErr(''); setMsg('')
    try {
      patch(await api.updateOrderStatus(order.id, status, markPaid))
      if (markPaid) setMsg(`訂單 ${order.order_no} 已標示為已收款並計入會員累積消費。`)
    } catch (e) {
      setErr(e.message)
    }
  }

  /**
   * 改狀態。把「還沒收到錢」的訂單標成已出貨或已完成時先問一次 ——
   * 之前就是這樣搞出「已完成」卻同時顯示「未付款．前往付款」的矛盾畫面。
   */
  const requestStatus = (order, status) => {
    const unpaidOnline = order.payment_method !== 'cod' && order.payment_status !== 'paid'
    if ((status === 'completed' || status === 'shipped') && unpaidOnline) {
      setPendingStatus({ order, status })
      return
    }
    changeStatus(order, status)
  }

  const createLogistics = async (order) => {
    setErr(''); setMsg(''); setHelp(null); setBusyId(order.id)
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
      // 綠界的失敗多半不是「再按一次就會好」，而是有東西要先去設定。
      // 有結構化說明就排成步驟，沒有才退回單行訊息。
      if (e.detail?.steps?.length) setHelp(e.detail)
      else setErr(e.message)
      load()
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

  const markPaid = async (order) => {
    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const res = await api.markPaid(order.order_no)
      setMsg(`訂單 ${order.order_no}：${res.message}`)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  /*
    退款。

    先去問後端「這一筆該怎麼退」再開面板 —— 付款方式與付款日期決定了
    是取消授權、退刷、還是只能自己匯款，這件事不該讓使用者自己記。
  */
  const openRefund = async (order) => {
    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const plan = await api.refundPlan(order.order_no)
      setRefund({ order, plan, amount: String(Math.round(plan.remaining || 0)), note: '' })
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const submitRefund = async (mode) => {
    if (!refund) return
    const { order, plan } = refund
    const amount = Number(refund.amount)
    if (!(amount > 0)) { setErr('請填寫退款金額'); return }

    /*
      這是後台唯一一個「按下去錢就出去、收不回來」的操作。
      再問一次「你確定嗎」沒有用 —— 那種框大家都直接按確定。
      所以 API 退款要求把金額重打一次，逼人真的看一眼自己在退多少。
    */
    if (mode === 'api') {
      const typed = window.prompt(
        `這會真的把 NT$${amount.toLocaleString('zh-TW')} 退給買家，而且收不回來。\n`
        + `確認的話請重新輸入金額（只填數字）：`,
      )
      if (typed === null) return
      if (Number(String(typed).replace(/[^\d.]/g, '')) !== amount) {
        setErr('輸入的金額跟要退的金額不一樣，已取消這次退款。')
        return
      }
    }

    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const res = await api.refundOrder(order.order_no, {
        amount, mode, note: refund.note,
      })
      setMsg(`訂單 ${order.order_no}：${res.message}`)
      setRefund(null)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const sweepExpired = async () => {
    setErr(''); setMsg(''); setSweeping(true)
    try {
      const res = await api.expireUnpaid()
      setMsg(res.message)
      load()
    } catch (e) {
      setErr(e.message)
    } finally {
      setSweeping(false)
    }
  }

  const printLabel = (order) => {
    window.open(apiUrl(`/api/logistics/orders/${order.id}/print`), '_blank', 'width=1000,height=760')
  }

  const unpaidList = orders.filter(isUnpaid)
  const overdueList = orders.filter(isOverdue)
  const mismatchList = orders.filter(isMismatch)
  const needShip = orders.filter(
    (o) => o.logistics_status === 'none' && o.status !== 'cancelled'
      && (o.payment_status === 'paid' || o.payment_method === 'cod'),
  )
  const unpaidValue = unpaidList.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)

  const visible = orders.filter((o) => {
    if (filter === 'need-ship') {
      return o.logistics_status === 'none' && o.status !== 'cancelled'
        && (o.payment_status === 'paid' || o.payment_method === 'cod')
    }
    if (filter === 'unpaid') return isUnpaid(o)
    if (filter === 'overdue') return isOverdue(o)
    if (filter === 'mismatch') return isMismatch(o)
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

      {/*
        退款面板。

        兩條路刻意並排：綠界後台手動退（大多數情況）與 API 一鍵退。
        API 那顆只有信用卡有 —— ATM、超商代碼、貨到付款綠界都沒有退款 API，
        放一顆按了會失敗的按鈕比不放還糟。
      */}
      {refund && (
        <div className="alert alert--warn">
          <strong>退款：訂單 {refund.order.order_no}　{refund.plan.title}</strong>

          <ol style={{ margin: '10px 0 0', paddingLeft: 20, listStyle: 'decimal' }}>
            {(refund.plan.steps || []).map((step, i) => (
              <li key={i} className="small" style={{ marginBottom: 6, lineHeight: 1.75 }}>
                {step.split(/(\*\*[^*]+\*\*)/g).map((part, n) => (
                  part.startsWith('**') && part.endsWith('**')
                    ? <strong key={n}>{part.slice(2, -2)}</strong>
                    : <span key={n}>{part}</span>
                ))}
              </li>
            ))}
          </ol>

          <table className="spec-table spec-table--wide" style={{ margin: '12px 0' }}>
            <tbody>
              <tr><th>訂單金額</th><td>NT${Number(refund.plan.total_amount).toLocaleString('zh-TW')}</td></tr>
              {Number(refund.plan.refunded_amount) > 0 && (
                <tr><th>已退金額</th><td>NT${Number(refund.plan.refunded_amount).toLocaleString('zh-TW')}</td></tr>
              )}
              <tr><th>可退餘額</th><td><strong>NT${Number(refund.plan.remaining).toLocaleString('zh-TW')}</strong></td></tr>
              {refund.plan.trade_no && (
                <tr>
                  <th>綠界交易編號</th>
                  <td style={{ fontFamily: 'monospace' }}>{refund.plan.trade_no}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="dgrid2" style={{ maxWidth: 560 }}>
            <div className="field">
              <label htmlFor="refund-amount">退款金額</label>
              <input id="refund-amount" className="input" type="number" min="1"
                     max={refund.plan.remaining}
                     value={refund.amount}
                     onChange={(e) => setRefund((r) => ({ ...r, amount: e.target.value }))} />
              <div className="field__hint">部分退款也可以（例如只退運費），會累加計算。</div>
            </div>
            <div className="field">
              <label htmlFor="refund-note">備註</label>
              <input id="refund-note" className="input" placeholder="例：匯款 8/22 後五碼 12345"
                     value={refund.note}
                     onChange={(e) => setRefund((r) => ({ ...r, note: e.target.value }))} />
              <div className="field__hint">自己看的紀錄，客人不會看到。</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            <a className="btn btn--outline btn--sm" href={refund.plan.vendor_url}
               target="_blank" rel="noreferrer">
              開啟綠界後台自己處理
            </a>
            <button type="button" className="btn btn--ghost btn--sm"
                    disabled={busyId === refund.order.id}
                    onClick={() => submitRefund('manual')}>
              標記為已退款（我已經處理完了）
            </button>
            {refund.plan.can_use_api && (
              <button type="button" className="btn btn--primary btn--sm"
                      disabled={busyId === refund.order.id}
                      onClick={() => submitRefund('api')}>
                向綠界送出{refund.plan.action_label}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRefund(null)}>
              先不要
            </button>
          </div>

          <p className="small muted" style={{ margin: '10px 0 0' }}>
            全額退款後，訂單會改成「已取消」，庫存自動還原，
            會員的累積消費也會扣回去（等級與折價券跟著重算）。
          </p>
        </div>
      )}

      {/*
        綠界建單失敗的說明。刻意排成步驟清單而不是一行紅字 ——
        這類失敗（餘額不足、金鑰設錯、門市停業）都不是「再按一次就會好」，
        店家需要知道去哪裡按什麼。
      */}
      {help && (
        <div className="alert alert--error">
          <strong>建立物流單失敗：{help.title}</strong>
          <ol style={{ margin: '10px 0 0', paddingLeft: 20, listStyle: 'decimal' }}>
            {help.steps.map((step, i) => (
              <li key={i} className="small" style={{ marginBottom: 6, lineHeight: 1.75 }}>
                {step.split(/(\*\*[^*]+\*\*)/g).map((part, n) => (
                  part.startsWith('**') && part.endsWith('**')
                    ? <strong key={n}>{part.slice(2, -2)}</strong>
                    : <span key={n}>{part}</span>
                ))}
              </li>
            ))}
          </ol>
          {help.raw && (
            <p className="small muted" style={{ margin: '10px 0 0' }}>
              綠界原文：{help.raw}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <a className="btn btn--outline btn--sm" href="https://vendor.ecpay.com.tw/"
               target="_blank" rel="noreferrer">
              開啟綠界廠商後台
            </a>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setHelp(null)}>
              我知道了
            </button>
          </div>
        </div>
      )}

      {pendingStatus && (
        <>
          <button type="button" className="edit-pop__backdrop" aria-label="關閉"
                  onClick={() => setPendingStatus(null)} />
          <div className="edit-pop" role="dialog" aria-label="確認訂單狀態">
            <div className="edit-pop__label">這筆訂單還沒收到款項</div>
            <div className="edit-pop__title">
              {pendingStatus.order.order_no}
            </div>
            <p className="edit-pop__hint">
              付款方式是「{pendingStatus.order.payment_method_label}」，
              目前狀態是「{PAYMENT_STATUS_TEXT[pendingStatus.order.payment_status]}」。
              <br /><br />
              如果你已經用別的方式收到錢（匯款、面交），請選「同時註記已收款」——
              系統會計入會員累積消費，客人那邊也不會再看到「前往付款」。
              <br /><br />
              如果錢還沒收到但要先出貨，選「只改狀態」，這筆會繼續留在待付款清單裡。
            </p>
            <div className="edit-pop__actions" style={{ flexDirection: 'column' }}>
              <button type="button" className="btn btn--primary btn--block"
                      onClick={() => {
                        changeStatus(pendingStatus.order, pendingStatus.status, true)
                        setPendingStatus(null)
                      }}>
                同時註記已收款
              </button>
              <button type="button" className="btn btn--outline btn--block"
                      onClick={() => {
                        changeStatus(pendingStatus.order, pendingStatus.status, false)
                        setPendingStatus(null)
                      }}>
                只改狀態，錢還沒收到
              </button>
              <button type="button" className="btn btn--ghost btn--block"
                      onClick={() => setPendingStatus(null)}>
                取消
              </button>
            </div>
          </div>
        </>
      )}

      {/* 每天最該看的三個數字。待付款金額是「還沒進帳但庫存已經被扣住」的錢。 */}
      <div className="order-stats">
        <button type="button" className={`order-stat${filter === 'need-ship' ? ' is-active' : ''}`}
                onClick={() => setFilter('need-ship')}>
          <div className="order-stat__num">{needShip.length}</div>
          <div className="order-stat__label">待出貨</div>
        </button>
        <button type="button" className={`order-stat${filter === 'unpaid' ? ' is-active' : ''}`}
                onClick={() => setFilter('unpaid')}>
          <div className="order-stat__num">{unpaidList.length}</div>
          <div className="order-stat__label">待付款．NT${formatPrice(unpaidValue)}</div>
        </button>
        <button type="button"
                className={`order-stat${overdueList.length ? ' order-stat--warn' : ''}${filter === 'overdue' ? ' is-active' : ''}`}
                onClick={() => setFilter('overdue')}>
          <div className="order-stat__num">{overdueList.length}</div>
          <div className="order-stat__label">逾期未付款</div>
        </button>
        <button type="button"
                className={`order-stat${mismatchList.length ? ' order-stat--warn' : ''}${filter === 'mismatch' ? ' is-active' : ''}`}
                onClick={() => setFilter('mismatch')}>
          <div className="order-stat__num">{mismatchList.length}</div>
          <div className="order-stat__label">帳沒對上</div>
        </button>
      </div>

      {mismatchList.length > 0 && (
        <div className="alert alert--error">
          <strong>有 {mismatchList.length} 筆訂單已出貨或已完成，付款狀態卻還是「未付款」</strong>
          <p className="small" style={{ margin: '6px 0 10px' }}>
            通常是改狀態時沒有勾「同時註記已收款」。
            這種訂單<strong>客人會看到東西收到了、網站卻說沒付錢</strong>，
            而且不會計入會員的累積消費。錢真的收到了就按下面的按鈕補上。
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {mismatchList.slice(0, 10).map((o) => (
              <button key={o.id} type="button" className="btn btn--outline btn--sm"
                      disabled={busyId === o.id} onClick={() => markPaid(o)}>
                {o.order_no} 已收款
              </button>
            ))}
          </div>
        </div>
      )}

      {overdueList.length > 0 && (
        <div className="alert alert--error">
          <strong>有 {overdueList.length} 筆訂單超過付款期限</strong>
          <p className="small" style={{ margin: '6px 0 10px' }}>
            這些訂單的商品還被鎖在庫存裡。清理後會自動取消訂單並把庫存還回來，
            買家不會被收任何費用。系統每小時也會自動跑一次。
          </p>
          <button type="button" className="btn btn--outline btn--sm"
                  onClick={sweepExpired} disabled={sweeping}>
            {sweeping ? '清理中…' : '立即清理逾期訂單'}
          </button>
        </div>
      )}

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
                          {isOverdue(o) && (
                            <div className="small" style={{ color: 'var(--danger)', fontWeight: 500 }}>
                              已逾期
                            </div>
                          )}
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
                                  value={o.status} onChange={(e) => requestStatus(o, e.target.value)}>
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

                              {/* 未付款訂單的處理選項。三個按鈕對應三種現實情況：
                                  綠界通知漏掉、買家用別的方式付了錢、買家不打算付了。 */}
                              {isUnpaid(o) && (
                                <div className="ship-box" style={{ marginBottom: 14 }}>
                                  <div className="small" style={{ marginBottom: 10 }}>
                                    <strong>這筆訂單還沒收到款項。</strong>
                                    {o.payment_message && (
                                      <span style={{ color: 'var(--danger)' }}>
                                        {' '}最近一次失敗原因：{o.payment_message}
                                      </span>
                                    )}
                                    {o.payment_attempts > 1 && (
                                      <span className="muted">　買家已嘗試付款 {o.payment_attempts} 次</span>
                                    )}
                                    {o.payment_deadline && (
                                      <div className="muted" style={{ marginTop: 4 }}>
                                        付款期限 {formatDate(o.payment_deadline)}
                                        {isOverdue(o) ? '（已逾期）' : ''}
                                      </div>
                                    )}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <button type="button" className="btn btn--outline btn--sm"
                                            disabled={busyId === o.id} onClick={() => syncPayment(o)}>
                                      向綠界查詢付款狀態
                                    </button>
                                    <button type="button" className="btn btn--ghost btn--sm"
                                            disabled={busyId === o.id} onClick={() => markPaid(o)}>
                                      手動註記已收款
                                    </button>
                                    <button type="button" className="btn btn--ghost btn--sm"
                                            disabled={busyId === o.id}
                                            onClick={() => changeStatus(o, 'cancelled')}>
                                      取消訂單並還原庫存
                                    </button>
                                    {/* 收到錢了才需要退款。沒收到錢直接取消訂單就好 */}
                                    {o.payment_status === 'paid' && (
                                      <button type="button" className="btn btn--ghost btn--sm"
                                              disabled={busyId === o.id} onClick={() => openRefund(o)}>
                                        退款…
                                      </button>
                                    )}
                                  </div>
                                  <p className="small muted" style={{ margin: '10px 0 0' }}>
                                    「手動註記已收款」用在綠界以外的收款（買家直接匯款、面交付現）。
                                    註記後會照正常流程計入會員累積消費。
                                  </p>
                                </div>
                              )}

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
