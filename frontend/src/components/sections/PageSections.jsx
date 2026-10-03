import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, formatDate } from '../../api/client'
import GroupBuyShippingNotice from '../GroupBuyShippingNotice'
import Placeholder from '../Placeholder'
import ProductCard from '../ProductCard'
import { Empty, PageHero, SectionHead } from './Common'
import { editable } from '../../context/EditModeContext'
import { useSettings } from '../../context/SettingsContext'
import { prose, softBreaks, stripEditorNotes } from '../../lib/text'

/**
 * 團購、品牌故事、商品列表、新聞列表這幾頁的內容。
 *
 * 跟 HomeSections／ContactSections 同一個模式：把原本寫在頁面裡的
 * 一段一段拆成獨立元件，頁面本身只剩「把這幾塊依序疊起來、
 * 決定底色與留白」，改文案時好找很多。
 *
 * 各頁最上面的標題橫幅（*Header）自己帶 <section>，其他區塊不帶。
 */

/** 把 **粗體** 轉成節點。文字只當文字用，不碰 innerHTML。 */
const bold = (text) => text.split(/\*\*(.+?)\*\*/g)
  .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))

// ---------------------------------------------------------------- 團購專區

// 這四步有先後順序，編號本身就是資訊，所以保留數字
const STEPS = [
  // 「|」是建議換行的位置，畫面上不會出現（見 lib/text.js 的 softBreaks）
  { num: '01', title: '選擇方案', desc: '從下方團購組合中|挑選適合的數量與品項。' },
  { num: '02', title: '線上下單', desc: '加入購物車後|填寫收件資料|即可送出訂單。' },
  { num: '03', title: '確認與付款', desc: '我們會以電話或 LINE |與您確認明細與付款方式。' },
  { num: '04', title: '安排出貨', desc: '款項確認後約 3-5 個工作天內出貨，並回報物流單號。' },
]

// 公司團購最在意的就是憑證這一題，所以話要講在前面，不要等到出貨才說沒有發票。
const GROUP_FAQ = [
  ['團購最低數量是多少？', '每個方案的成團數量不同，請參考各方案說明。若數量較大想再談價格，歡迎直接聯絡我們。'],
  ['可以分開寄送到不同地址嗎？',
    '可以，但**不能直接在網站下單**。網站的購物車一筆訂單只收一次運費，'
    + '物流系統也只會產生一個包裹的寄件代碼，所以線上下單的團購組合只寄一個地址，'
    + '由主購收到後自行分發。'
    + '需要分開寄的話請先用 LINE 或電話跟我們說收件人數與地址，'
    + '我們會依件數報價（多一個地址就多一筆運費），談好再幫您建立訂單。'],
  ['可以開立統一發票嗎？',
    '我們是自產自銷的養蜂場，依營業稅法免辦營業登記、免徵營業稅，因此沒有統一編號，'
    + '不開立統一發票，改開「農民收據」。收據上會載明品名、數量、金額與本場名稱、'
    + '地址、負責人，多數公司行號可憑此核銷，但每家公司的規定不同，'
    + '建議先跟貴公司會計確認。需要收據抬頭請在訂單備註寫明。'],
  ['多久可以出貨？', '款項確認後約 3-5 個工作天出貨；年節期間出貨量大，會另行公告。'],
]

export function GroupHeader() {
  // 團購組合都是紅淡蜜：用紅淡比標籤的資訊面（蜂蜜黃）與紅淡比的花，不用鴨腳木的天空藍
  return <PageHero tone="honey" art="cleyera" title="團購專區" desc="公司行號、社區揪團、學校與社團採購，數量越多單價越優惠" />
}

export function GroupIntro() {
  const { settings } = useSettings()
  return (
    <div className="split">
      <div className="split__copy">
        <h2 className="split__title">一起買，更划算</h2>
        {/*
          這裡不能寫「可分別寄送到不同地址」而不加條件。
          網站的購物車一筆訂單只收一次運費、綠界也只產生一個寄件代碼，
          客人直接下單是分不了寄的 —— 那句話會變成收完錢才發現做不到。
          分寄確實做得到，但要另外報價，所以要引導他先聯絡。
        */}
        <p className="split__text">
          {'我們是基隆七堵的小型蜂場，產量有限但每一批都自己顧。'}
          {'下方的團購組合可以直接下單，寄到一個地址、由主購分發，並開立農民收據。'}
          {'需要'}<strong>分開包裝、分別寄到不同地址</strong>{'，或客製標籤與贈品卡，請先聯絡我們報價。'}
        </p>
        <div className="split__actions">
          <Link to="/contact" className="btn btn--primary">洽詢客製方案</Link>
          {settings.line_url && (
            <a href={settings.line_url} target="_blank" rel="noreferrer" className="btn btn--outline">
              用 LINE 詢問
            </a>
          )}
        </div>
      </div>
      <div className="split__media"
           {...editable('團購情境照', '/admin/settings', 'group_buy_image_url', '建議橫式、約 1200×900，有背景的實拍（例如整箱包裝好的樣子）最好，讓客人看清楚實際的包裝。')}>
        <Placeholder
          src={settings.group_buy_image_url}
          ratio="4x3"
          art="apiary"
          hint={'團購情境照\n（後台「網站設定 → 圖片」上傳）'}
          alt="團購情境照"
        />
      </div>
    </div>
  )
}

export function GroupSteps() {
  return (
    <ol className="steps">
      {STEPS.map((s) => (
        <li className="step" key={s.num}>
          <span className="step__num" aria-hidden="true">{s.num}</span>
          <h3 className="step__title">{s.title}</h3>
          <p className="step__desc">{softBreaks(s.desc)}</p>
        </li>
      ))}
    </ol>
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
      <SectionHead title="團購組合" />
      {/* 運送方式講在商品上面，不是下面 —— 客人往下滑看到喜歡的就直接按了 */}
      <GroupBuyShippingNotice />
      {loading ? (
        <div className="loading">載入中…</div>
      ) : products.length === 1 ? (
        // 只有一個方案時橫著放，不要孤零零一小格
        <div className="group-single">
          <ProductCard product={products[0]} variant="wide" />
        </div>
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
      <SectionHead title="常見問題" />
      <dl className="faq">
        {GROUP_FAQ.map(([q, a]) => (
          <div className="faq__item" key={q}>
            <dt className="faq__q"><span className="faq__mark">Q．</span>{q}</dt>
            <dd className="faq__a">{bold(a)}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

// ---------------------------------------------------------------- 品牌故事

export function StoryHeader() {
  // 墨色：標籤上所有字與線的顏色；紅淡比的花開在上面，像山裡的夜
  return <PageHero tone="ink" art="cleyera" title="品牌故事" desc="關於基隆的雨、山裡的花，以及一瓶蜜為什麼要多等一次花期" />
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

  return (
    <div className="chapters">
      {stories.map((s, idx) => (
        <article className="chapter" key={s.id}
                 {...editable(`故事：${s.title}`, '/admin/stories', null,
                   '標題、副標題、內文與照片都在故事管理裡改。')}>
          <div className="chapter__media">
            {/* 故事照片保持原色；框固定 4:3／3:2 交錯，建議上傳橫的照片 */}
            <Placeholder
              src={s.cover_url}
              ratio={idx % 2 === 0 ? '4x3' : '3x2'}
              art="apiary"
              alt={s.title}
              hint={`故事照片\nstory-${s.id}.jpg`}
            />
          </div>
          <div className="chapter__copy">
            <h2 className="chapter__title">{prose(s.title)}</h2>
            {s.subtitle && <p className="chapter__sub">{prose(s.subtitle)}</p>}
            <p className="chapter__text">{prose(stripEditorNotes(s.content))}</p>
          </div>
        </article>
      ))}
    </div>
  )
}

export function StoryCta() {
  return (
    <div className="cta-band__inner">
      <h2 className="cta-band__title">想嘗嘗看嗎</h2>
      <p className="cta-band__desc">從最經典的龍眼蜜開始，或直接看看團購方案</p>
      <div className="cta-band__actions">
        <Link to="/products" className="btn btn--ink btn--lg">選購蜂蜜</Link>
        <Link to="/group-buy" className="btn btn--outline btn--lg">團購方案</Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- 商品列表

export function ProductsHeader() {
  return (
    <PageHero
      tone="coral"
      art="cleyera"
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
      <div className="filter-bar" role="group" aria-label="商品分類">
        <button type="button" className={`chip${active === '' ? ' active' : ''}`}
                aria-pressed={active === ''} onClick={() => setParams({})}>
          全部商品
        </button>
        {categories.map((c) => (
          <button type="button" key={c.id}
                  className={`chip${active === c.slug ? ' active' : ''}`}
                  aria-pressed={active === c.slug}
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
  return <PageHero tone="bloom" title="新聞報導" desc="媒體報導、產季公告與最新活動消息" />
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
      <div className="filter-bar" role="group" aria-label="消息分類">
        {TABS.map((t) => (
          <button type="button" key={t.key}
                  className={`chip${tab === t.key ? ' active' : ''}`}
                  aria-pressed={tab === t.key}
                  onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">載入中…</div>
      ) : items.length ? (
        <div className="news-list">
          {items.map((n) => (
            <Link to={`/news/${n.id}`} key={n.id} className="news-item news-item--row"
                  {...editable(`報導：${n.title}`, '/admin/news', null,
                    '在新聞管理裡找到這一則點「編輯」。')}>
              <Placeholder src={n.cover_url} ratio="4x3" art="apiary" alt={n.title}
                           hint={`報導照片\nnews-${n.id}.jpg`} />
              <div className="news-item__body">
                <div className="news-item__meta">
                  <span className={`news-tag${n.category === 'media' ? ' news-tag--media' : ''}`}>
                    {n.category === 'media' ? '媒體報導' : '最新消息'}
                  </span>
                  <span className="news-item__date">{formatDate(n.published_at)}</span>
                  {n.source && <span className="news-item__date">{n.source}</span>}
                </div>
                <h2 className="news-item__title">{prose(n.title)}</h2>
                <p className="news-item__summary">{prose(n.summary)}</p>
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
