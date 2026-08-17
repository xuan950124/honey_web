import { NavLink, Outlet } from 'react-router-dom'

const MENU = [
  { to: '/admin', label: '總覽', end: true },
  { to: '/admin/products', label: '商品管理' },
  { to: '/admin/categories', label: '分類管理' },
  { to: '/admin/news', label: '新聞管理' },
  { to: '/admin/stories', label: '故事管理' },
  { to: '/admin/orders', label: '訂單管理' },
  { to: '/admin/members', label: '會員管理' },
  { to: '/admin/membership', label: '等級與折價券' },
  { to: '/admin/settings', label: '網站設定' },
]

export default function AdminLayout() {
  return (
    <section className="section" style={{ paddingTop: 40 }}>
      <div className="container">
        <div className="admin">
          <nav className="admin-nav">
            <div className="admin-nav__head">工作人員後台</div>
            {MENU.map((m) => (
              <NavLink key={m.to} to={m.to} end={m.end}>{m.label}</NavLink>
            ))}
          </nav>
          <div><Outlet /></div>
        </div>
      </div>
    </section>
  )
}
