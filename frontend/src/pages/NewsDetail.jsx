import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatDate } from '../api/client'
import Icon from '../components/Icon'
import Placeholder from '../components/Placeholder'
import { editable } from '../context/EditModeContext'
import { prose } from '../lib/text'

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
          <Link to="/news" className="btn btn--outline">回到新聞列表</Link>
        </div>
      </div>
    )
  }
  if (!item) return <div className="loading">載入中…</div>

  return (
    <section className="section section--top-tight">
      <article className="container article">
        <div className="breadcrumb">
          <Link to="/">首頁</Link><span>/</span>
          <Link to="/news">新聞報導</Link><span>/</span>
          {item.title}
        </div>

        <div className="article__meta">
          <span className={`news-tag${item.category === 'media' ? ' news-tag--media' : ''}`}>
            {item.category === 'media' ? '媒體報導' : '最新消息'}
          </span>
          <span className="news-item__date">{formatDate(item.published_at)}</span>
          {item.source && <span className="news-item__date">來源：{item.source}</span>}
        </div>

        <h1 className="article__title" {...editable('報導標題', '/admin/news')}>
          {prose(item.title)}
        </h1>

        {/* fit="auto"：報導照片常常是截圖或直式照片，固定 16:9 會把標題和人切掉 */}
        <Placeholder
          src={item.cover_url}
          fit="auto"
          art="apiary"
          alt={item.title}
          hint={`報導主圖\nnews-${item.id}.jpg`}
          className="article__cover"
          {...editable('報導主圖', '/admin/news', null,
            '照片會照原始比例顯示、不裁切，太大會自動縮到跟內文一樣寬。')}
        />

        {item.summary && <p className="article__lead">{prose(item.summary)}</p>}

        <div className="article__body">{prose(item.content)}</div>

        {item.source_url && (
          <p className="article__source">
            <a href={item.source_url} target="_blank" rel="noreferrer" className="btn btn--outline">
              閱讀原始報導<Icon name="external" />
            </a>
          </p>
        )}

        <div className="article__back">
          <Link to="/news" className="btn btn--ghost"><Icon name="back" />回到新聞列表</Link>
        </div>
      </article>
    </section>
  )
}
