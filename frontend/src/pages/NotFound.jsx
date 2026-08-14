import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <section className="section">
      <div className="container">
        <div className="empty-state" style={{ padding: '100px 20px' }}>
          <div className="empty-state__title" style={{ fontSize: 30 }}>404</div>
          <p>找不到這個頁面，可能已被移除或網址輸入錯誤。</p>
          <Link to="/" className="btn btn--primary" style={{ marginTop: 18 }}>回到首頁</Link>
        </div>
      </div>
    </section>
  )
}
