import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useSettings } from '../context/SettingsContext'

const NAV = [
  { to: '/', label: '首頁', end: true },
  { to: '/products', label: '蜂蜜商品' },
  { to: '/group-buy', label: '團購專區' },
  { to: '/news', label: '新聞報導' },
  { to: '/story', label: '品牌故事' },
  { to: '/contact', label: '聯絡我們' },
]

export default function Header() {
  const { user, logout, isStaff } = useAuth()
  const { count } = useCart()
  const { settings } = useSettings()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    setOpen(false)
    navigate('/')
  }

  return (
    <header className="header">
      <div className="header__topbar">
        <div className="container">
          <span>{settings.shop_slogan || '台灣蜂場直送．純粹不添加'}</span>
          <span>
            {settings.contact_phone ? (
              <a href={`tel:${settings.contact_phone}`}>訂購專線 {settings.contact_phone}</a>
            ) : (
              <Link to="/contact">聯絡我們</Link>
            )}
          </span>
        </div>
      </div>

      <div className="container">
        <div className="header__inner">
          <Link to="/" className="logo" onClick={() => setOpen(false)}>
            <span className="logo__mark">{settings.shop_name || '蜂蜜工坊'}</span>
            <span className="logo__sub">Honey</span>
          </Link>

          <nav className={`nav${open ? ' open' : ''}`}>
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                {item.label}
              </NavLink>
            ))}
            {isStaff && (
              <NavLink to="/admin" onClick={() => setOpen(false)}>
                後台管理
              </NavLink>
            )}
          </nav>

          <div className="header__actions">
            <Link to="/cart" className="icon-btn">
              購物車
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>

            {user ? (
              <>
                <Link to="/member" className="icon-btn">
                  {user.name}
                </Link>
                <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
                  登出
                </button>
              </>
            ) : (
              <Link to="/login" className="btn btn--primary btn--sm">
                會員登入
              </Link>
            )}

            <button
              type="button"
              className="hamburger"
              onClick={() => setOpen((v) => !v)}
              aria-label="開啟選單"
              aria-expanded={open}
            >
              <span />
              <span />
              <span />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
