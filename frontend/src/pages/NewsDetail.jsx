import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatDate } from '../api/client'
import Placeholder from '../components/Placeholder'

export default function NewsDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    window.scrollTo(0, 0)
    api.getNews(id).then(setItem).catch((e) => setError(e.message))
  }, [id])

  if (error) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__title">{error}</div>
          <Link to="/news" className="btn btn--outline" style={{ marginTop: 16 }}>回到新聞列表</Link>
        </div>
      </div>
    )
  }
  if (!item) return <div className="loading">載入中…</div>

  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="breadcrumb">
          <Link to="/">首頁</Link><span>/</span>
          <Link to="/news">新聞報導</Link><span>/</span>
          {item.title}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <span className={`news-tag${item.category === 'media' ? ' news-tag--media' : ''}`}>
            {item.category === 'media' ? '媒體報導' : '最新消息'}
          </span>
          <span className="news-item__date">{formatDate(item.published_at)}</span>
          {item.source && <span className="news-item__date">來源：{item.source}</span>}
        </div>

        <h1 style={{ fontSize: 30, color: 'var(--honey-900)', marginBottom: 24, lineHeight: 1.45 }}>
          {item.title}
        </h1>

        <Placeholder
          src={item.cover_url}
          ratio="16x9"
          alt={item.title}
          hint={`報導主圖\nnews-${item.id}.jpg`}
        />

        {item.summary && (
          <p style={{ marginTop: 28, fontSize: 16, color: 'var(--honey-800)', fontWeight: 500, lineHeight: 1.9 }}>
            {item.summary}
          </p>
        )}

        <div style={{ whiteSpace: 'pre-line', color: 'var(--ink-soft)', marginTop: 18, fontSize: 15 }}>
          {item.content}
        </div>

        {item.source_url && (
          <p style={{ marginTop: 28 }}>
            <a href={item.source_url} target="_blank" rel="noreferrer" className="btn btn--outline">
              閱讀原始報導
            </a>
          </p>
        )}

        <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--line)' }}>
          <Link to="/news" className="btn btn--ghost">← 回到新聞列表</Link>
        </div>
      </div>
    </section>
  )
}
