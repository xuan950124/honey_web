import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

const SETTINGS = '/admin/settings'

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
  const { settings, loaded } = useSettings()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // 換頁時自動收起選單
  useEffect(() => setOpen(false), [location.pathname])

  // 選單展開時鎖住背景捲動，避免手機上背景跟著滑
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const handleLogout = () => {
    logout()
    setOpen(false)
    navigate('/')
  }

  return (
    <>
    <header className="header">
      <div className="header__topbar">
        <div className="container">
          <span className={loaded ? '' : 'is-pending'}
                {...editable('頁首標語', SETTINGS, 'shop_slogan', '這一條深色橫條上的短標語，10~16 個字最好看。')}>
            {settings.shop_slogan || '台灣蜂場直送．純粹不添加'}
          </span>
          <span {...editable('訂購專線', SETTINGS, 'contact_phone')}>
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
          <Link to="/" className="logo" {...editable('網站名稱', SETTINGS, 'shop_name')}>
            <span className={`logo__mark${loaded ? '' : ' is-pending'}`}>
              {settings.shop_name || '蜂蜜工坊'}
            </span>
            <span className="logo__sub">Honey</span>
          </Link>

          {/* 電腦版主選單 */}
          <nav className="nav">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
            ))}
            {isStaff && <NavLink to="/admin">後台管理</NavLink>}
          </nav>

          {/* data-edit-skip：購物車與會員按鈕在編輯模式下要照正常運作 */}
          <div className="header__actions" data-edit-skip>
            <Link to="/cart" className="icon-btn icon-btn--cart" aria-label="購物車">
              <span className="icon-btn__text">購物車</span>
              <span className="icon-btn__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M6 6h15l-1.5 9h-12z" strokeLinejoin="round" />
                  <path d="M6 6 5 2H2" strokeLinecap="round" />
                  <circle cx="9" cy="20" r="1.4" fill="currentColor" stroke="none" />
                  <circle cx="18" cy="20" r="1.4" fill="currentColor" stroke="none" />
                </svg>
              </span>
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>

            {/* 電腦版才顯示的會員區 */}
            <div className="header__account">
              {user ? (
                <>
                  <Link to="/member" className="icon-btn">{user.name}</Link>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
                    登出
                  </button>
                </>
              ) : (
                <Link to="/login" className="btn btn--primary btn--sm">會員登入</Link>
              )}
            </div>

            <button
              type="button"
              className={`hamburger${open ? ' is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? '關閉選單' : '開啟選單'}
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

      {/*
        抽屜刻意放在 <header> 外面。
        .header 有 backdrop-filter，依 CSS 規範會成為子孫 position:fixed 的「包含區塊」，
        抽屜若放在裡面，top/bottom 會相對於頁首那一條而不是整個畫面，內容就會被壓掉看不見。
      */}
      {open && <button type="button" className="drawer-backdrop" aria-label="關閉選單" onClick={() => setOpen(false)} />}
      <nav className={`drawer${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="drawer__section">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="drawer__link">
              {item.label}
            </NavLink>
          ))}
          {isStaff && <NavLink to="/admin" className="drawer__link">後台管理</NavLink>}
        </div>

        <div className="drawer__section">
          {user ? (
            <>
              <div className="drawer__user">
                <div className="drawer__user-name">{user.name}</div>
                <div className="drawer__user-mail">{user.email}</div>
              </div>
              <NavLink to="/member" className="drawer__link">會員中心．我的訂單</NavLink>
              <button type="button" className="drawer__link drawer__link--button" onClick={handleLogout}>
                登出
              </button>
            </>
          ) : (
            <div className="drawer__auth">
              <Link to="/login" className="btn btn--primary btn--block">會員登入</Link>
              <Link to="/register" className="btn btn--outline btn--block">加入會員</Link>
            </div>
          )}
        </div>

        {(settings.contact_phone || settings.line_id) && (
          <div className="drawer__section drawer__contact">
            {settings.contact_phone && (
              <a href={`tel:${settings.contact_phone}`}>訂購專線 {settings.contact_phone}</a>
            )}
            {settings.line_id && <span>LINE {settings.line_id}</span>}
          </div>
        )}
      </nav>
    </>
  )
}
