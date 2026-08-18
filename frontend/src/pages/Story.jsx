import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import Placeholder from '../components/Placeholder'
import { editable } from '../context/EditModeContext'
import { stripEditorNotes } from '../lib/text'

export default function Story() {
  const [stories, setStories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .listStories()
      .then(setStories)
      .catch(() => setStories([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">品牌故事</h1>
          <p className="page-hero__desc">關於基隆的雨、山裡的花，以及一瓶蜜為什麼要多等一次花期</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          {loading ? (
            <div className="loading">載入中…</div>
          ) : stories.length ? (
            stories.map((s, idx) => (
              <div className="story-row" key={s.id}
                   {...editable(`故事：${s.title}`, '/admin/stories', null,
                     '標題、副標題、內文與照片都在故事管理裡改。')}>
                <div className="story-row__media">
                  {/* 不裁切：故事照片是實景照，裁掉一半就失去意義了 */}
                  <Placeholder
                    src={s.cover_url}
                    fit="auto"
                    ratio={idx % 2 === 0 ? '4x3' : '3x2'}
                    alt={s.title}
                    hint={`故事照片\nstory-${s.id}.jpg`}
                  />
                </div>
                <div>
                  <div className="section-head__eyebrow" style={{ textAlign: 'left' }}>
                    Chapter {String(idx + 1).padStart(2, '0')}
                  </div>
                  <h2 className="story-row__title">{s.title}</h2>
                  {s.subtitle && <div className="story-row__sub">{s.subtitle}</div>}
                  <p className="story-row__text">{stripEditorNotes(s.content)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">故事內容準備中</div>
              <p>工作人員可於後台「故事管理」新增品牌故事段落。</p>
            </div>
          )}
        </div>
      </section>

      <section className="section section--dark">
        <div className="container text-center">
          <h2 className="section-head__title" style={{ marginBottom: 14 }}>想嘗嘗看嗎</h2>
          <p style={{ color: 'var(--honey-200)', marginBottom: 26 }}>
            從最經典的龍眼蜜開始，或直接看看團購方案
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/products" className="btn btn--light">選購蜂蜜</Link>
            <Link to="/group-buy" className="btn btn--outline"
                  style={{ borderColor: 'var(--honey-300)', color: 'var(--honey-200)' }}>
              團購方案
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
