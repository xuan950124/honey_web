import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'
import { Lettering } from './Brand'
import Icon from './Icon'

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
  const [scrolled, setScrolled] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // 換頁時自動收起選單
  useEffect(() => setOpen(false), [location.pathname])

  // 選單展開時鎖住背景捲動，避免手機上背景跟著滑
  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 捲下去之後頁首多一條底線與淡陰影，跟內容分開
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleLogout = () => {
    logout()
    setOpen(false)
    navigate('/')
  }

  return (
    <>
    <header className={`header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="header__topbar">
        <div className="container">
          <span className={loaded ? '' : 'is-pending'}
                {...editable('頁首標語', SETTINGS, 'shop_slogan', '最上面那一條墨色橫條上的短標語，10~16 個字最好看。')}>
            {settings.shop_slogan || '台灣蜂場直送．純粹不添加'}
          </span>
          <span {...editable('訂購專線', SETTINGS, 'contact_phone')}>
            {settings.contact_phone ? (
              <a href={`tel:${settings.contact_phone}`} className="header__phone">
                <Icon name="phone" size={16} />訂購專線 <span className="nowrap">{settings.contact_phone}</span>
              </a>
            ) : (
              <Link to="/contact">聯絡我們</Link>
            )}
          </span>
        </div>
      </div>

      <div className="container">
        <div className="header__inner">
          <Link to="/" className="logo" {...editable('網站名稱', SETTINGS, 'shop_name')}>
            {/* Logo：基隆市地圖畫成的花＋蜜蜂（從標籤完稿拆出來的向量檔） */}
            <Lettering name="logo" className="logo__mark" />
            {/* 店名是「黃家基蜜」時用標籤上的字（拆出來的向量字）；後台改了店名就改用文字 */}
            <span className={`logo__name${loaded ? '' : ' is-pending'}`}>
              {settings.shop_name === '黃家基蜜'
                ? <Lettering name="wordmark-zh" className="logo__wordmark" label={settings.shop_name} />
                : (settings.shop_name || '蜂蜜工坊')}
            </span>
          </Link>

          {/* 電腦版主選單 */}
          <nav className="nav" aria-label="主選單">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end}>{item.label}</NavLink>
            ))}
            {isStaff && <NavLink to="/admin">後台管理</NavLink>}
          </nav>

          {/* data-edit-skip：購物車與會員按鈕在編輯模式下要照正常運作 */}
          <div className="header__actions" data-edit-skip>
            <Link to="/cart" className="icon-btn icon-btn--cart"
                  aria-label={count > 0 ? `購物車，${count} 件` : '購物車'}>
              <Icon name="cart" size={20} />
              <span className="icon-btn__text">購物車</span>
              {count > 0 && <span className="cart-count">{count}</span>}
            </Link>

            {/* 電腦版才顯示的會員區 */}
            <div className="header__account">
              {user ? (
                <>
                  <Link to="/member" className="header__user">{user.name}</Link>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>
                    登出
                  </button>
                </>
              ) : (
                <Link to="/login" className="btn btn--outline btn--sm">會員登入</Link>
              )}
            </div>

            <button
              type="button"
              className={`hamburger${open ? ' is-open' : ''}`}
              onClick={() => setOpen((v) => !v)}
              aria-label={open ? '關閉選單' : '開啟選單'}
              aria-expanded={open}
              aria-controls="site-drawer"
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
        如果頁首哪天加了 backdrop-filter 或 transform，依 CSS 規範它會成為子孫
        position:fixed 的「包含區塊」，抽屜放在裡面的話 top/bottom 會相對於頁首那一條，
        而不是整個畫面，內容就會被壓掉看不見。
      */}
      <button type="button" className={`drawer-backdrop${open ? ' is-open' : ''}`}
              aria-label="關閉選單" aria-hidden={!open} tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)} />
      <nav id="site-drawer" className={`drawer${open ? ' is-open' : ''}`} aria-hidden={!open}
           aria-label="選單" inert={open ? undefined : ''}>
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
              <a href={`tel:${settings.contact_phone}`}>
                <Icon name="phone" size={16} />訂購專線 {settings.contact_phone}
              </a>
            )}
            {settings.line_id && <span>LINE {settings.line_id}</span>}
          </div>
        )}
      </nav>
    </>
  )
}
