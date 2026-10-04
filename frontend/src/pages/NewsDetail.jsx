import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatDate } from '../api/client'
import Icon from '../components/Icon'
import Placeholder from '../components/Placeholder'
import { editable } from '../context/EditModeContext'
import { articleBlocks, prose } from '../lib/text'

const OTHERS = 4   // 右欄「其他報導」最多幾則

const tagText = (category) => (category === 'media' ? '媒體報導' : '最新消息')
const tagClass = (category) => `news-tag${category === 'media' ? ' news-tag--media' : ''}`

/*
  報導內文頁。

  電腦版（1000px 以上）：標題橫跨整個內容寬，底下一條 2px 墨線；
  左欄是照片、導言、內文，右欄是「其他報導」，捲動時跟著。
  原本整篇擠在左邊 760px，大螢幕右半邊全空，標題還被擠成三行。

  手機：一欄，順序照 DOM —— 標題、照片、內文，其他報導放在文章後面。
*/
export default function NewsDetail() {
  const { id } = useParams()
  const [item, setItem] = useState(null)
  const [error, setError] = useState('')
  const [latest, setLatest] = useState(null)   // null＝其他報導還在載入

  useEffect(() => {
    window.scrollTo(0, 0)
    setItem(null)
    setError('')
    setLatest(null)
    api.getNews(id).then(setItem).catch((e) => setError(e.message))
    // 多拿一則：清單裡可能包含正在看的這一篇
    api.listNews({ limit: OTHERS + 1 })
      .then((list) => setLatest(Array.isArray(list) ? list : []))
      .catch(() => setLatest([]))
  }, [id])

  const others = (latest || []).filter((n) => String(n.id) !== String(id)).slice(0, OTHERS)
  // 確定沒有其他報導（只有這一篇，或清單載不到）才收成一欄；還在載入時先留著右欄，載完才不會整版跳動
  const solo = latest !== null && others.length === 0

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

  const blocks = articleBlocks(item.content)
  const hasHeadline = blocks.some((b) => b.type === 'headline')

  return (
    <section className="section section--top-tight">
      <article className={`container article${solo ? ' article--solo' : ''}`}>
        <header className="article__head">
          <div className="breadcrumb">
            <Link to="/">首頁</Link><span>/</span>
            <Link to="/news">新聞報導</Link><span>/</span>
            {item.title}
          </div>

          <div className="article__meta">
            <span className={tagClass(item.category)}>{tagText(item.category)}</span>
            <span className="news-item__date">{formatDate(item.published_at)}</span>
            {item.source && <span className="news-item__date">來源：{item.source}</span>}
          </div>

          <h1 className="article__title" {...editable('報導標題', '/admin/news')}>
            {prose(item.title)}
          </h1>
        </header>

        <div className="article__main">
          {/* fit="auto"：報導照片常常是截圖或直式照片，固定 16:9 會把標題和人切掉 */}
          <Placeholder
            src={item.cover_url}
            fit="auto"
            art="apiary"
            alt={item.title}
            hint={`報導主圖\nnews-${item.id}.jpg`}
            className="article__cover"
            {...editable('報導主圖', '/admin/news', null,
              '照片會照原始比例顯示、不裁切，太大會自動縮到欄寬。')}
          />

          {item.summary && <p className="article__lead">{prose(item.summary)}</p>}

          <div className="article__body">
            {blocks.map((block, i) => {
              if (block.type === 'headline') {
                return <h2 key={i} className="article__headline">{prose(block.text)}</h2>
              }
              if (block.type === 'subhead') {
                // 有【】報導標題時小標排在它底下（h3），沒有就直接接在頁面標題底下（h2），標題層級不跳號
                const Sub = hasHeadline ? 'h3' : 'h2'
                return <Sub key={i} className="article__subhead">{prose(block.text)}</Sub>
              }
              const cls = block.type === 'note' ? 'article__note' : 'article__para'
              return <p key={i} className={cls}>{prose(block.text)}</p>
            })}
          </div>

          {item.source_url && (
            <p className="article__source">
              <a href={item.source_url} target="_blank" rel="noreferrer" className="btn btn--outline">
                閱讀原始報導<Icon name="external" />
              </a>
            </p>
          )}
        </div>

        {others.length > 0 && (
          <aside className="article__aside" aria-labelledby="more-news-title">
            {/* 照商品頁「食品標示」那張表的樣子：一圈墨框、標題置中拉開字距、細線分列 */}
            <div className="more-news">
              <h2 className="more-news__title" id="more-news-title">其他報導</h2>
              <ul className="more-news__list">
                {others.map((n) => (
                  <li key={n.id}>
                    <Link to={`/news/${n.id}`} className="more-news__item">
                      <span className="more-news__meta">
                        <span className={tagClass(n.category)}>{tagText(n.category)}</span>
                        <span className="news-item__date">{formatDate(n.published_at)}</span>
                      </span>
                      <span className="more-news__name">{prose(n.title)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}

        <div className="article__back">
          <Link to="/news" className="btn btn--ghost"><Icon name="back" />回到新聞列表</Link>
        </div>
      </article>
    </section>
  )
}
