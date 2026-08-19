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
            <div className="grid grid--3 grid--products">
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
              // 公司團購最在意的就是這一題，所以話要講在前面，不要等到出貨才說沒有發票。
              ['可以開立統一發票嗎？',
                '我們是自產自銷的養蜂場，依營業稅法免辦營業登記、免徵營業稅，因此沒有統一編號，'
                + '不開立統一發票，改開「農民收據」。收據上會載明品名、數量、金額與本場名稱、'
                + '地址、負責人，多數公司行號可憑此核銷，但每家公司的規定不同，'
                + '建議先跟貴公司會計確認。需要收據抬頭請在訂單備註寫明。'],
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
