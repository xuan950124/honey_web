import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ORDER_STATUS_TEXT, api, formatDate, formatPrice } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

export default function AdminDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ products: 0, groupBuy: 0, news: 0, orders: 0 })
  const [recent, setRecent] = useState([])
  const [checkout, setCheckout] = useState(null)
  const [noPhoto, setNoPhoto] = useState([])

  useEffect(() => {
    Promise.all([
      api.listProducts({ include_inactive: true }),
      api.listNews({ include_inactive: true }),
      api.allOrders(),
    ])
      .then(([products, news, orders]) => {
        setStats({
          products: products.length,
          groupBuy: products.filter((p) => p.is_group_buy).length,
          news: news.length,
          orders: orders.length,
        })
        setRecent(orders.slice(0, 5))
        setNoPhoto(products.filter((p) => p.is_active && !p.image_url))
      })
      .catch(() => {})
    api.checkoutOptions().then(setCheckout).catch(() => {})
  }, [])

  // 綠界的金流與物流是分開審核的，狀態要分開看。
  // 物流過了就能用貨到付款開賣，不必等金流。
  const ec = checkout?.ecpay_status || {}
  const loaded = Boolean(checkout)
  const canCod = Boolean(ec.can_sell_cod)
  const canOnline = Boolean(ec.can_sell_online)

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">總覽</h1>
        <span className="muted small">您好，{user?.name}</span>
      </div>

      {/*
        上線檢查。這兩件事都是「網站看起來正常、但實際上會出事」的類型：
        測試金流收不到錢，沒照片的商品幾乎不會有人買。
        所以放在後台第一眼看得到的位置，而不是等人自己想起來。
      */}
      {loaded && !(canOnline && canCod) && (
        <div className={`alert alert--${canCod ? 'info' : 'error'}`}>
          <strong>
            綠界目前的狀態：金流「{canOnline ? '正式' : '測試'}」．物流「{canCod ? '正式' : '測試'}」
          </strong>

          <table className="spec-table" style={{ margin: '10px 0' }}>
            <tbody>
              <tr>
                <th style={{ width: 130 }}>線上付款</th>
                <td>
                  {canOnline
                    ? '正式環境，客人的付款會真的入帳。'
                    : '還是測試環境，信用卡／ATM／超商代碼收不到錢。結帳頁會顯示測試卡號提示。'}
                </td>
              </tr>
              <tr>
                <th>物流與貨到付款</th>
                <td>
                  {canCod
                    ? '正式環境，可以真的建立物流單、真的收現金。'
                    : '還是測試環境，建立的物流單不是真的，不要拿去超商寄件。'}
                </td>
              </tr>
            </tbody>
          </table>

          {canCod && !canOnline ? (
            <p className="small" style={{ margin: 0 }}>
              <strong>物流已經可以用了，所以你現在就能開賣 —— 只開放「貨到付款」。</strong>
              客人在超商取貨時付現，錢由綠界代收後撥到你的綠界帳戶
              （提領要等金流審核通過，但那筆錢跑不掉）。
              等金流過了再把 <code>ECPAY_ENV</code> 設成 <code>production</code>，
              信用卡與 ATM 就會一起開放。
            </p>
          ) : (
            <p className="small" style={{ margin: 0 }}>
              綠界的金流與物流是<strong>分開審核</strong>的，物流通常先過。
              物流一過就可以先開賣貨到付款 —— 把後端的
              <code> ECPAY_LOGISTICS_ENV </code>設成<code> production </code>
              並填入正式的物流金鑰即可，不用等金流。
              金流過了之後再設<code> ECPAY_ENV=production </code>。
            </p>
          )}
        </div>
      )}

      {noPhoto.length > 0 && (
        <div className="alert alert--info">
          <strong>有 {noPhoto.length} 個上架中的商品還沒有主圖</strong>
          <p className="small" style={{ margin: '6px 0 10px' }}>
            沒有照片的商品幾乎不會有人下單。客人看到的是「照片準備中」的空白框。
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {noPhoto.slice(0, 8).map((p) => (
              <Link key={p.id} to={`/admin/products/${p.id}`} className="btn btn--outline btn--sm">
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat"><div className="stat__label">商品總數</div><div className="stat__num">{stats.products}</div></div>
        <div className="stat"><div className="stat__label">團購方案</div><div className="stat__num">{stats.groupBuy}</div></div>
        <div className="stat"><div className="stat__label">新聞則數</div><div className="stat__num">{stats.news}</div></div>
        <div className="stat"><div className="stat__label">訂單總數</div><div className="stat__num">{stats.orders}</div></div>
      </div>

      <div className="panel">
        <h2 className="panel__title">快速操作</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/admin/products/new" className="btn btn--primary">新增商品</Link>
          <Link to="/admin/news" className="btn btn--outline">新增新聞</Link>
          <Link to="/admin/stories" className="btn btn--outline">編輯故事</Link>
          <Link to="/admin/settings" className="btn btn--outline">修改聯絡方式</Link>
        </div>
      </div>

      <div className="panel">
        <h2 className="panel__title">最新訂單</h2>
        {recent.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>訂單編號</th><th>收件人</th><th>日期</th><th>金額</th><th>狀態</th></tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td style={{ fontFamily: 'monospace' }}>{o.order_no}</td>
                    <td>{o.receiver_name}</td>
                    <td>{formatDate(o.created_at)}</td>
                    <td>NT${formatPrice(o.total_amount)}</td>
                    <td><span className={`tag tag--${o.status}`}>{ORDER_STATUS_TEXT[o.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>目前還沒有訂單。</p>
        )}
      </div>
    </>
  )
}
