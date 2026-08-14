import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import Placeholder from '../components/Placeholder'
import ProductCard from '../components/ProductCard'
import { useSettings } from '../context/SettingsContext'

const STEPS = [
  { num: '01', title: '選擇方案', desc: '從下方團購組合中挑選適合的數量與品項。' },
  { num: '02', title: '線上下單', desc: '加入購物車後填寫收件資料即可送出訂單。' },
  { num: '03', title: '確認與付款', desc: '我們會以電話或 LINE 與您確認明細與付款方式。' },
  { num: '04', title: '安排出貨', desc: '款項確認後約 3-5 個工作天內出貨，並回報物流單號。' },
]

export default function GroupBuy() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const { settings } = useSettings()

  useEffect(() => {
    api
      .listProducts({ group_buy: true })
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [])

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">團購專區</h1>
          <p className="page-hero__desc">公司行號、社區揪團、學校與社團採購，數量越多單價越優惠</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="hero__grid" style={{ padding: 0 }}>
            <div>
              <div className="section-head__eyebrow" style={{ textAlign: 'left' }}>Group Buy</div>
              <h2 className="hero__title" style={{ fontSize: 30 }}>一起買，更划算</h2>
              <p className="hero__desc">
                我們提供彈性的團購方案：可分開包裝、分別寄送到不同地址，也能依需求製作客製標籤與贈品卡，
                並開立二聯或三聯式發票。若您的需求不在下方方案內，歡迎直接與我們聯絡討論。
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
            <Placeholder ratio="4x3" hint={'團購情境照\ngroup-buy.jpg'} alt="團購情境照" />
          </div>
        </div>
      </section>

      <section className="section--tight">
        <div className="container">
          <div className="features">
            {STEPS.map((s) => (
              <div className="feature" key={s.num}>
                <div className="feature__num">STEP {s.num}</div>
                <h3 className="feature__title">{s.title}</h3>
                <p className="feature__desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section section--cream">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">Packages</div>
            <h2 className="section-head__title">團購組合</h2>
          </div>

          {loading ? (
            <div className="loading">載入中…</div>
          ) : products.length ? (
            <div className="grid grid--3">
              {products.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">目前沒有團購方案</div>
              <p>工作人員可於後台新增商品時勾選「團購商品」，即會顯示在這裡。</p>
            </div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">FAQ</div>
            <h2 className="section-head__title">常見問題</h2>
          </div>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            {[
              ['團購最低數量是多少？', '每個方案的成團數量不同，請參考各方案說明。若數量較大想再談價格，歡迎直接聯絡我們。'],
              ['可以分開寄送到不同地址嗎？', '可以。請在下單時於備註欄註明各收件人的姓名、電話與地址，我們會與您再次確認。'],
              ['可以開立發票嗎？', '可以開立二聯或三聯式發票，請在訂單備註提供抬頭與統一編號。'],
              ['多久可以出貨？', '款項確認後約 3-5 個工作天出貨；年節期間出貨量大，會另行公告。'],
            ].map(([q, a]) => (
              <div key={q} style={{ padding: '20px 0', borderBottom: '1px solid var(--line)' }}>
                <h3 style={{ fontSize: 16, color: 'var(--honey-800)', marginBottom: 8 }}>Q．{q}</h3>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
