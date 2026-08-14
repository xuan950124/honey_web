import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ORDER_STATUS_TEXT, api, formatDate, formatPrice } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

export default function AdminDashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ products: 0, groupBuy: 0, news: 0, orders: 0 })
  const [recent, setRecent] = useState([])

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
      })
      .catch(() => {})
  }, [])

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">總覽</h1>
        <span className="muted small">您好，{user?.name}</span>
      </div>

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
