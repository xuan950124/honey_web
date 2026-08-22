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

/*
  待出貨 = **包裹還在你手上**。

  這裡踩過兩個坑，都是把「待出貨」定義成別的東西造成的：

  1. 原本要求 `logistics_status === 'none'`（還沒建物流單）。
     但建完單、拿到寄件代碼、還沒拿去超商的訂單才是最該出貨的那一批 ——
     結果真正要出的貨反而不會出現在待出貨清單裡。

  2. 原本沒有排除**已完成**的訂單。舊的測試訂單是「已完成 + 未建單」，
     兩個條件都符合，於是佔滿了待出貨清單。

  所以判斷要看兩件事：**訂單還沒走完**，而且**包裹還沒送出去**。
*/

/** 物流走到這幾個狀態，代表包裹還沒交出去。 */
const NOT_HANDED_OVER = ['none', 'created', 'failed']

/** 訂單走到這幾個狀態就不必再出貨了。 */
const DONE_STATUSES = ['cancelled', 'completed', 'shipped']

const isNeedShip = (o) =>
  !DONE_STATUSES.includes(o.status)
  && NOT_HANDED_OVER.includes(o.logistics_status || 'none')
  // 錢收到了才出貨；貨到付款例外，那本來就是取貨才收錢
  && (o.payment_status === 'paid' || o.payment_method === 'cod')

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

  /*
    永久刪除訂單。主要用途是清掉測試期間留下的假單 ——
    混在真訂單裡會讓「待出貨」「待付款」這些每天要看的數字失去意義。

    要求把訂單編號打完整才刪：這個動作**救不回來**，
    而 window.confirm 那種框大家都是直接按確定。
  */
  const removeOrder = async (order) => {
    const typed = window.prompt(
      `永久刪除訂單 ${order.order_no}？\n\n`
      + `明細、金額、綠界交易編號、出貨紀錄都會消失，而且救不回來。\n`
      + `庫存會還原，計入的會員消費也會扣回去。\n\n`
      + `確定的話請把訂單編號完整輸入一次：`,
    )
    if (typed === null) return
    if (typed.trim() !== order.order_no) {
      setErr('輸入的訂單編號不符，已取消刪除。')
      return
    }

    setErr(''); setMsg(''); setBusyId(order.id)
    try {
      const res = await api.deleteOrder(order.id, order.order_no)
      setMsg(res.message)
      setOpenId(null)
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

  /*
    列印託運單。

    先換一張只能列印、只活五分鐘的通行證，再把它帶在網址上開新視窗。

    為什麼不能直接開：window.open 是一次**普通的瀏覽器導航，不會帶
    Authorization 標頭** —— 登入權杖存在 localStorage，只有 fetch 會幫忙加。
    所以直接開一定會看到「登入憑證無效或已過期」。

    也不能把登入權杖塞進網址：它有七天效期，而網址會留在瀏覽器紀錄、
    Referer 與伺服器日誌裡。

    視窗要**先開再填網址** —— 等 await 回來才 window.open 會被瀏覽器
    當成非使用者觸發的彈出視窗而擋掉。
  */
  const printLabel = async (order) => {
    const win = window.open('', '_blank', 'width=1000,height=760')
    setErr(''); setBusyId(order.id)
    try {
      const { token } = await api.printToken(order.id)
      const url = apiUrl(`/api/logistics/orders/${order.id}/print?t=${encodeURIComponent(token)}`)
      if (win) win.location.replace(url)
      else window.open(url, '_blank', 'width=1000,height=760')   // 彈出視窗被擋時再試一次
    } catch (e) {
      win?.close()
      setErr(`拿不到列印通行證：${e.message}`)
    } finally {
      setBusyId(null)
    }
  }

  const unpaidList = orders.filter(isUnpaid)
  const overdueList = orders.filter(isOverdue)
  const mismatchList = orders.filter(isMismatch)
  const needShip = orders.filter(isNeedShip)
  // 待出貨裡面還沒建物流單的 —— 這些要先按「建立物流單」才拿得到寄件代碼
  const needLabel = needShip.filter((o) => (o.logistics_status || 'none') === 'none')
  const unpaidValue = unpaidList.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)

  const visible = orders.filter((o) => {
    // 統計數字與清單用同一個判斷 —— 分開寫過一次，兩邊就馬上走鐘了
    if (filter === 'need-ship') return isNeedShip(o)
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
          <div className="order-stat__label">
            待出貨
            {/* 分成「還沒建單」與「已建單等你拿去超商」——
                兩者要做的事完全不同，合成一個數字看不出下一步 */}
            {needShip.length > 0 && (
              <span className="muted">
                　{needLabel.length ? `${needLabel.length} 筆待建單` : '都已建單'}
              </span>
            )}
          </div>
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
                  const isCancelled = o.status === 'cancelled'
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
                                  </div>
                                  <p className="small muted" style={{ margin: '10px 0 0' }}>
                                    「手動註記已收款」用在綠界以外的收款（買家直接匯款、面交付現）。
                                    註記後會照正常流程計入會員累積消費。
                                  </p>
                                </div>
                              )}

                              {/*
                                已收到錢的訂單才需要退款。

                                這一塊刻意跟上面的「未付款處理」分開 ——
                                之前把退款按鈕放進 isUnpaid 的區塊裡，
                                而 isUnpaid 依定義就不會包含已付款的訂單，
                                所以那顆按鈕永遠不會出現。
                              */}
                              {o.payment_status === 'paid' && (
                                <div className="ship-box" style={{ marginBottom: 14 }}>
                                  <div className="small" style={{ marginBottom: 10 }}>
                                    <strong>已收到款項 NT${formatPrice(o.total_amount)}</strong>
                                    {Number(o.refunded_amount) > 0 && (
                                      <span style={{ color: 'var(--danger)' }}>
                                        {' '}已退 NT${formatPrice(o.refunded_amount)}
                                      </span>
                                    )}
                                    <span className="muted">　（{o.payment_method_label}）</span>
                                  </div>
                                  <button type="button" className="btn btn--ghost btn--sm"
                                          disabled={busyId === o.id} onClick={() => openRefund(o)}>
                                    退款…
                                  </button>
                                  <p className="small muted" style={{ margin: '10px 0 0' }}>
                                    按下去會先告訴你這一筆該怎麼退（取消授權還是退刷），
                                    不會直接動到錢。
                                  </p>
                                </div>
                              )}
                              {o.payment_status === 'refunded' && (
                                <div className="ship-box" style={{ marginBottom: 14 }}>
                                  <div className="small">
                                    <strong>這筆已全額退款</strong>
                                    <span className="muted">
                                      　NT${formatPrice(o.refunded_amount)}
                                      {o.refunded_at ? `．${formatDate(o.refunded_at)}` : ''}
                                    </span>
                                    {o.refund_note && (
                                      <div className="muted" style={{ marginTop: 4 }}>
                                        備註：{o.refund_note}
                                      </div>
                                    )}
                                  </div>
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
                                ) : isCancelled ? (
                                  /*
                                    已取消的訂單不給建物流單。

                                    之前這裡沒判斷狀態，取消的訂單照樣顯示按鈕，
                                    按下去就真的建單了 —— 綠界扣運費、託運單印出來，
                                    而那筆訂單早就取消。

                                    改成講清楚「為什麼不能按」而不是把按鈕變灰，
                                    灰掉的按鈕不會告訴你要怎麼辦。
                                  */
                                  <div className="small muted">
                                    這筆訂單<strong>已取消</strong>，不能建立物流單。
                                    <br />
                                    如果要重新出貨，先把上面的訂單狀態改回「已付款」或「待處理」。
                                  </div>
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

                              {/*
                                永久刪除。放在最下面、樣式最不顯眼 ——
                                這是清測試單用的，不是日常操作。
                                真的要作廢一筆訂單請用「取消訂單」，那個留得下紀錄。
                              */}
                              <div style={{
                                marginTop: 18, paddingTop: 14,
                                borderTop: '1px solid var(--line)',
                                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                              }}>
                                <button type="button" className="btn btn--ghost btn--sm"
                                        style={{ color: 'var(--danger)' }}
                                        disabled={busyId === o.id}
                                        onClick={() => removeOrder(o)}>
                                  永久刪除這筆訂單
                                </button>
                                <span className="small muted">
                                  清測試單用。會要求輸入訂單編號，刪掉救不回來 ——
                                  只是要作廢請改用「取消訂單」，那個留得下紀錄。
                                </span>
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
