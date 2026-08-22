import { useEffect } from 'react'
import { Route, Routes, useLocation, useSearchParams } from 'react-router-dom'

import EditOverlay from './components/EditOverlay'
import Footer from './components/Footer'
import Header from './components/Header'
import DevicePreview from './components/DevicePreview'
import ProtectedRoute from './components/ProtectedRoute'
import SiteMeta from './components/SiteMeta'
import { useAuth } from './context/AuthContext'
import { useCart } from './context/CartContext'
import { useEditMode } from './context/EditModeContext'
import usePageTracking from './hooks/usePageTracking'

import Cart from './pages/Cart'
import ForgotPassword from './pages/ForgotPassword'
import Contact from './pages/Contact'
import GroupBuy from './pages/GroupBuy'
import Home from './pages/Home'
import Login from './pages/Login'
import Member from './pages/Member'
import News from './pages/News'
import NewsDetail from './pages/NewsDetail'
import NotFound from './pages/NotFound'
import OrderDetail from './pages/OrderDetail'
import Policy from './pages/Policy'
import ProductDetail from './pages/ProductDetail'
import Products from './pages/Products'
import Register from './pages/Register'
import ResetPassword from './pages/ResetPassword'
import VerifyEmail from './pages/VerifyEmail'
import Story from './pages/Story'

import AdminCategories from './pages/admin/AdminCategories'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminLayout from './pages/admin/AdminLayout'
import AdminMembers from './pages/admin/AdminMembers'
import AdminMembership from './pages/admin/AdminMembership'
import AdminNews from './pages/admin/AdminNews'
import AdminOrders from './pages/admin/AdminOrders'
import AdminPolicies from './pages/admin/AdminPolicies'
import AdminProductForm from './pages/admin/AdminProductForm'
import AdminProducts from './pages/admin/AdminProducts'
import AdminSettings from './pages/admin/AdminSettings'
import AdminStats from './pages/admin/AdminStats'
import AdminStories from './pages/admin/AdminStories'

/** 每次換頁記一次瀏覽。工作人員與關掉統計的裝置不算，詳見 usePageTracking。 */
function PageTracker() {
  usePageTracking()
  return null
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])
  return null
}

export default function App() {
  const { toast } = useCart()
  const { isStaff } = useAuth()
  const { enabled: editing, setEnabled: setEditing } = useEditMode()
  const [params] = useSearchParams()
  // 在預覽用的 iframe 裡面不要再顯示預覽按鈕，避免無限巢狀
  const inPreview = params.get('preview') === '1'

  // 登出之後要把編輯模式關掉，不然下一個登入的一般會員會看到虛線框
  useEffect(() => {
    if (!isStaff && editing) setEditing(false)
  }, [isStaff, editing, setEditing])

  return (
    <>
      <SiteMeta />
      <ScrollToTop />
      <PageTracker />
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/group-buy" element={<GroupBuy />} />
          <Route path="/news" element={<News />} />
          <Route path="/news/:id" element={<NewsDetail />} />
          <Route path="/story" element={<Story />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/privacy" element={<Policy page="privacy" />} />
          <Route path="/terms" element={<Policy page="terms" />} />
          <Route path="/refund" element={<Policy page="refund" />} />
          <Route path="/cart" element={<Cart />} />
          <Route path="/order/:orderNo" element={<OrderDetail />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

          <Route
            path="/member"
            element={<ProtectedRoute><Member /></ProtectedRoute>}
          />

          <Route
            path="/admin"
            element={<ProtectedRoute staffOnly><AdminLayout /></ProtectedRoute>}
          >
            <Route index element={<AdminDashboard />} />
            <Route path="products" element={<AdminProducts />} />
            <Route path="products/new" element={<AdminProductForm />} />
            <Route path="products/:id" element={<AdminProductForm />} />
            <Route path="categories" element={<AdminCategories />} />
            <Route path="news" element={<AdminNews />} />
            <Route path="stories" element={<AdminStories />} />
            <Route path="orders" element={<AdminOrders />} />
            <Route path="stats" element={<AdminStats />} />
            <Route path="members" element={<AdminMembers />} />
            <Route path="membership" element={<AdminMembership />} />
            <Route path="settings" element={<AdminSettings />} />
            <Route path="policies" element={<AdminPolicies />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
      {toast && <div className="toast">{toast}</div>}
      {isStaff && !inPreview && <DevicePreview />}
      {isStaff && !inPreview && <EditOverlay />}
    </>
  )
}
