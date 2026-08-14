import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatDate } from '../api/client'
import Placeholder from '../components/Placeholder'

const TABS = [
  { key: '', label: '全部' },
  { key: 'media', label: '新聞報導' },
  { key: 'news', label: '最新消息' },
]

export default function News() {
  const [items, setItems] = useState([])
  const [tab, setTab] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api
      .listNews({ category: tab || undefined })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tab])

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">新聞報導</h1>
          <p className="page-hero__desc">媒體報導、產季公告與最新活動消息</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="filter-bar">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.key}
                className={`chip${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="loading">載入中…</div>
          ) : items.length ? (
            <div style={{ maxWidth: 900, margin: '0 auto' }}>
              {items.map((n) => (
                <Link to={`/news/${n.id}`} key={n.id} className="news-item">
                  <Placeholder
                    src={n.cover_url}
                    ratio="4x3"
                    alt={n.title}
                    hint={`報導照片\nnews-${n.id}.jpg`}
                  />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span className={`news-tag${n.category === 'media' ? ' news-tag--media' : ''}`}>
                        {n.category === 'media' ? '媒體報導' : '最新消息'}
                      </span>
                      <span className="news-item__date">{formatDate(n.published_at)}</span>
                      {n.source && <span className="news-item__date">{n.source}</span>}
                    </div>
                    <h2 className="news-item__title">{n.title}</h2>
                    <p className="news-item__summary">{n.summary}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">目前沒有消息</div>
              <p>工作人員可於後台「新聞管理」新增報導與公告。</p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
