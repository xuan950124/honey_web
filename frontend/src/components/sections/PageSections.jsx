import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, formatDate } from '../../api/client'
import Placeholder from '../Placeholder'
import ProductCard from '../ProductCard'
import { editable } from '../../context/EditModeContext'
import { useSettings } from '../../context/SettingsContext'
import { stripEditorNotes } from '../../lib/text'

/**
 * 團購、品牌故事、商品列表、新聞列表這幾頁的內容。
 *
 * 跟 HomeSections／ContactSections 同一個模式：把原本寫在頁面裡的
 * 一段一段拆成獨立元件，頁面本身只剩「把這幾塊依序疊起來、
 * 決定底色與留白」，改文案時好找很多。
 */

// 頁面標題那條淺色橫幅。四頁共用同一個外觀，只有文字不同。
const PageHero = ({ title, desc }) => (
  <>
    <h1 className="page-hero__title">{title}</h1>
    <p className="page-hero__desc">{desc}</p>
  </>
)

const SectionHead = ({ eyebrow, title }) => (
  <div className="section-head">
    <div className="section-head__eyebrow">{eyebrow}</div>
    <h2 className="section-head__title">{title}</h2>
  </div>
)

const Empty = ({ title, children }) => (
  <div className="empty-state">
    <div className="empty-state__title">{title}</div>
    <p>{children}</p>
  </div>
)

// ---------------------------------------------------------------- 團購專區

const STEPS = [
  { num: '01', title: '選擇方案', desc: '從下方團購組合中挑選適合的數量與品項。' },
  { num: '02', title: '線上下單', desc: '加入購物車後填寫收件資料即可送出訂單。' },
  { num: '03', title: '確認與付款', desc: '我們會以電話或 LINE 與您確認明細與付款方式。' },
  { num: '04', title: '安排出貨', desc: '款項確認後約 3-5 個工作天內出貨，並回報物流單號。' },
]

// 公司團購最在意的就是憑證這一題，所以話要講在前面，不要等到出貨才說沒有發票。
const GROUP_FAQ = [
  ['團購最低數量是多少？', '每個方案的成團數量不同，請參考各方案說明。若數量較大想再談價格，歡迎直接聯絡我們。'],
  ['可以分開寄送到不同地址嗎？', '可以。請在下單時於備註欄註明各收件人的姓名、電話與地址，我們會與您再次確認。'],
  ['可以開立統一發票嗎？',
    '我們是自產自銷的養蜂場，依營業稅法免辦營業登記、免徵營業稅，因此沒有統一編號，'
    + '不開立統一發票，改開「農民收據」。收據上會載明品名、數量、金額與本場名稱、'
    + '地址、負責人，多數公司行號可憑此核銷，但每家公司的規定不同，'
    + '建議先跟貴公司會計確認。需要收據抬頭請在訂單備註寫明。'],
  ['多久可以出貨？', '款項確認後約 3-5 個工作天出貨；年節期間出貨量大，會另行公告。'],
]

export function GroupHeader() {
  return <PageHero title="團購專區" desc="公司行號、社區揪團、學校與社團採購，數量越多單價越優惠" />
}

export function GroupIntro() {
  const { settings } = useSettings()
  return (
    <div className="hero__grid" style={{ padding: 0 }}>
      <div>
        <div className="section-head__eyebrow" style={{ textAlign: 'left' }}>Group Buy</div>
        <h2 className="hero__title" style={{ fontSize: 30 }}>一起買，更划算</h2>
        <p className="hero__desc">
          我們是基隆七堵的小型蜂場，產量有限但每一批都自己顧。
          團購可分開包裝、分別寄送到不同地址，也能依需求製作客製標籤與贈品卡，
          並開立農民收據。需求不在下方方案內，歡迎直接聯絡討論。
        </p>
        <div className="hero__actions">
          <Link to="/contact" className="btn btn--primary">洽詢客製方案</Link>
          {settings.line_url && (
            <a href={settings.line_url} target="_blank" rel="noreferrer" className="btn btn--outline">
              用 LINE 詢問
            </a>
          )}
        </div>
      </div>
      <Placeholder
        src={settings.group_buy_image_url}
        ratio="4x3"
        hint={'團購情境照\n（後台「網站設定 → 圖片」上傳）'}
        alt="團購情境照"
      />
    </div>
  )
}

export function GroupSteps() {
  return (
    <div className="features">
      {STEPS.map((s) => (
        <div className="feature" key={s.num}>
          <div className="feature__num">STEP {s.num}</div>
          <h3 className="feature__title">{s.title}</h3>
          <p className="feature__desc">{s.desc}</p>
        </div>
      ))}
    </div>
  )
}

export function GroupPackages() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listProducts({ group_buy: true })
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <SectionHead eyebrow="Packages" title="團購組合" />
      {loading ? (
        <div className="loading">載入中…</div>
      ) : products.length ? (
        <div className="grid grid--3 grid--products">
          {products.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      ) : (
        <Empty title="目前沒有團購方案">
          工作人員可於後台新增商品時勾選「團購商品」，即會顯示在這裡。
        </Empty>
      )}
    </>
  )
}

export function GroupFaq() {
  return (
    <>
      <SectionHead eyebrow="FAQ" title="常見問題" />
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        {GROUP_FAQ.map(([q, a]) => (
          <div key={q} style={{ padding: '20px 0', borderBottom: '1px solid var(--line)' }}>
            <h3 style={{ fontSize: 16, color: 'var(--honey-800)', marginBottom: 8 }}>Q．{q}</h3>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>{a}</p>
          </div>
        ))}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- 品牌故事

export function StoryHeader() {
  return <PageHero title="品牌故事" desc="關於基隆的雨、山裡的花，以及一瓶蜜為什麼要多等一次花期" />
}

export function StoryChapters() {
  const [stories, setStories] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.listStories()
      .then(setStories)
      .catch(() => setStories([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">載入中…</div>
  if (!stories.length) {
    return (
      <Empty title="故事內容準備中">
        工作人員可於後台「故事管理」新增品牌故事段落。
      </Empty>
    )
  }

  return stories.map((s, idx) => (
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
}

export function StoryCta() {
  return (
    <div className="text-center">
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
  )
}

// ---------------------------------------------------------------- 商品列表

export function ProductsHeader() {
  return (
    <PageHero
      title="蜂蜜商品"
      desc="基隆七堵自家蜂場採收，依花期分批裝瓶，每一批的色澤與風味都略有不同"
    />
  )
}

export function ProductsGrid() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const active = params.get('category') || ''

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    api.listProducts({ category: active || undefined })
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [active])

  const visible = useMemo(
    () => products.filter((p) => !p.is_group_buy || active),
    [products, active],
  )

  return (
    <>
      <div className="filter-bar">
        <button type="button" className={`chip${active === '' ? ' active' : ''}`}
                onClick={() => setParams({})}>
          全部商品
        </button>
        {categories.map((c) => (
          <button type="button" key={c.id}
                  className={`chip${active === c.slug ? ' active' : ''}`}
                  onClick={() => setParams({ category: c.slug })}>
            {c.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">載入商品中…</div>
      ) : visible.length ? (
        <div className="grid grid--4 grid--products">
          {visible.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      ) : (
        <Empty title="這個分類目前沒有商品">
          工作人員可於後台「商品管理」新增商品。
        </Empty>
      )}
    </>
  )
}

// ---------------------------------------------------------------- 新聞列表

const TABS = [
  { key: '', label: '全部' },
  { key: 'media', label: '新聞報導' },
  { key: 'news', label: '最新消息' },
]

export function NewsHeader() {
  return <PageHero title="新聞報導" desc="媒體報導、產季公告與最新活動消息" />
}

export function NewsList() {
  const [items, setItems] = useState([])
  const [tab, setTab] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.listNews({ category: tab || undefined })
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [tab])

  return (
    <>
      <div className="filter-bar">
        {TABS.map((t) => (
          <button type="button" key={t.key}
                  className={`chip${tab === t.key ? ' active' : ''}`}
                  onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">載入中…</div>
      ) : items.length ? (
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          {items.map((n) => (
            <Link to={`/news/${n.id}`} key={n.id} className="news-item"
                  {...editable(`報導：${n.title}`, '/admin/news', null,
                    '在新聞管理裡找到這一則點「編輯」。')}>
              <Placeholder src={n.cover_url} ratio="4x3" alt={n.title}
                           hint={`報導照片\nnews-${n.id}.jpg`} />
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
        <Empty title="目前沒有消息">
          工作人員可於後台「新聞管理」新增報導與公告。
        </Empty>
      )}
    </>
  )
}
