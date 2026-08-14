import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children, staffOnly = false }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div className="loading">載入中…</div>

  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (staffOnly && user.role !== 'staff') {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__title">沒有存取權限</div>
          <p>這個區域僅開放工作人員帳號使用。若需要權限，請聯絡網站管理員。</p>
        </div>
      </div>
    )
  }

  return children
}
