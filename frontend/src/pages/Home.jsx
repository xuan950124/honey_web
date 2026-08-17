import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatDate } from '../api/client'
import Placeholder from '../components/Placeholder'
import ProductCard from '../components/ProductCard'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

const SETTINGS = '/admin/settings'

// 首頁主視覺的預設文案。後台「網站設定 → 首頁主視覺文案」可以改，不用動程式碼。
//
// 賣點刻意選「可以被查證的事」——產地、熟成、溯源編號。
// 「第幾代養蜂」這種故事型的說法查不到也比不出來，對第一次買的人沒有說服力。
const HERO = {
  title: '基隆山裡',
  highlight: '等熟成才採的蜜',
  desc: '蜂場就在基隆七堵的山上。我們等蜜在巢裡封蓋、熟成了才採，裝瓶前不加水、不加糖。'
    + '每一瓶都查得到生產者是誰 —— 農業部的溯源編號就印在上面。',
}

const FEATURES = [
  { num: '01', title: '自家蜂場直送', desc: '蜂場就在基隆七堵，採收後就近裝瓶出貨，不經過中盤。' },
  { num: '02', title: '熟成才採收', desc: '等蜜在巢裡封蓋熟成才採，裝瓶前不加水、不加糖、不調味。' },
  { num: '03', title: '政府溯源可查', desc: '已登錄農業部農糧署溯源系統，掃碼就查得到生產者是誰。' },
  { num: '04', title: '團購可客製', desc: '公司行號、社團大量訂購可分裝、開立發票與客製標籤。' },
]

export default function Home() {
  const [featured, setFeatured] = useState([])
  const [groupBuy, setGroupBuy] = useState([])
  const [news, setNews] = useState([])
  const [stories, setStories] = useState([])
  const { settings, loaded } = useSettings()

  useEffect(() => {
    api.listProducts({ featured: true }).then((d) => setFeatured(d.slice(0, 4))).catch(() => {})
    api.listProducts({ group_buy: true }).then((d) => setGroupBuy(d.slice(0, 3))).catch(() => {})
    api.listNews({ limit: 4 }).then(setNews).catch(() => {})
    api.listStories().then((d) => setStories(d.slice(0, 1))).catch(() => {})
  }, [])

  const story = stories[0]

  return (
    <>
      {/* Hero */}
      <section className="hero">
        <div className="container">
          <div className="hero__grid">
            <div>
              <div className="hero__eyebrow">Keelung Local Honey</div>
              <h1 className="hero__title"
                  {...editable('首頁大標', SETTINGS, 'hero_title', '兩行大字。第二行會是金色，那是整個網站最先被看到的一句話。')}>
                {settings.hero_title || HERO.title}
                <br />
                <em>{settings.hero_highlight || HERO.highlight}</em>
              </h1>
              <p className={`hero__desc${loaded ? '' : ' is-pending'}`}
                 {...editable('首頁說明文', SETTINGS, 'hero_desc', '頁尾的品牌介紹也會用這一段。')}>
                {settings.hero_desc || HERO.desc}
              </p>
              <div className="hero__actions">
                <Link to="/products" className="btn btn--primary">選購蜂蜜</Link>
                <Link to="/group-buy" className="btn btn--outline">團購方案</Link>
              </div>
              <div className="hero__facts">
                <div>
                  <div className="hero__fact-num">基隆</div>
                  <div className="hero__fact-label">七堵自家蜂場</div>
                </div>
                <div>
                  <div className="hero__fact-num">0</div>
                  <div className="hero__fact-label">人工添加物</div>
                </div>
                <div>
                  <div className="hero__fact-num">可溯源</div>
                  <div className="hero__fact-label">農業部追溯編號</div>
                </div>
              </div>
            </div>
            <div {...editable('首頁主視覺照片', SETTINGS, 'hero_image_url', '建議橫式、約 1200×900。蜂場或蜂箱的實景照最有說服力。')}>
              <Placeholder
                src={settings.hero_image_url}
                ratio="4x3"
                alt="首頁主視覺"
                hint={'首頁主視覺\n（後台「網站設定 → 圖片」上傳）'}
              />
            </div>
          </div>
        </div>
      </section>

      {/* 特色 */}
      <section className="section--tight">
        <div className="container">
          {/* 這四個特色目前寫在程式裡（上方的 FEATURES），所以提示會說明要找我改 */}
          <div className="features"
               {...editable('品牌四大特色', '/admin/settings', null, '這四項目前寫在程式碼裡，後台改不了。要調整請跟我說要換成哪四點。')}>
            {FEATURES.map((f) => (
              <div className="feature" key={f.num}>
                <div className="feature__num">{f.num}</div>
                <h3 className="feature__title">{f.title}</h3>
                <p className="feature__desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 精選商品 */}
      <section className="section">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">Our Honey</div>
            <h2 className="section-head__title">精選蜂蜜</h2>
            <p className="section-head__desc">基隆山區採收，依花期分批裝瓶，每一批的顏色與香氣都略有不同</p>
          </div>

          {featured.length ? (
            <div className="grid grid--4 grid--products"
                 {...editable('首頁精選商品', '/admin/products', null, '在商品管理裡把商品勾選「首頁精選」，就會出現在這一區。')}>
              {featured.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">尚未設定精選商品</div>
              <p>工作人員登入後台後，將商品勾選「首頁精選」即會顯示於此。</p>
            </div>
          )}

          <div className="text-center" style={{ marginTop: 44 }}>
            <Link to="/products" className="btn btn--outline">查看全部商品</Link>
          </div>
        </div>
      </section>

      {/* 團購 */}
      <section className="section section--cream">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">Group Buy</div>
            <h2 className="section-head__title">團購專區</h2>
            <p className="section-head__desc">公司行號、社區揪團、幼兒園採購，可分裝與客製標籤</p>
          </div>

          {groupBuy.length ? (
            <div className="grid grid--3 grid--products"
                 {...editable('團購商品', '/admin/products', null, '把商品勾選「團購商品」就會出現在這一區與團購專區。')}>
              {groupBuy.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">尚未建立團購方案</div>
              <p>工作人員可於後台新增商品時勾選「團購商品」。</p>
            </div>
          )}

          <div className="text-center" style={{ marginTop: 44 }}>
            <Link to="/group-buy" className="btn btn--primary">了解團購方案</Link>
          </div>
        </div>
      </section>

      {/* 故事 */}
      {story && (
        <section className="section">
          <div className="container">
            <div className="story-row" style={{ marginBottom: 0 }}
                 {...editable('品牌故事', '/admin/stories', null, '這裡顯示排序第一則故事的開頭 160 字。')}>
              <div className="story-row__media">
                <Placeholder
                  src={story.cover_url}
                  fit="auto"
                  ratio="4x3"
                  alt={story.title}
                  hint={'故事照片\nstory-1.jpg'}
                />
              </div>
              <div>
                <div className="section-head__eyebrow" style={{ textAlign: 'left' }}>Our Story</div>
                <h2 className="story-row__title">{story.title}</h2>
                {story.subtitle && <div className="story-row__sub">{story.subtitle}</div>}
                <p className="story-row__text">
                  {(story.content || '').slice(0, 160)}
                  {(story.content || '').length > 160 ? '…' : ''}
                </p>
                <Link to="/story" className="btn btn--outline" style={{ marginTop: 12 }}>
                  閱讀完整故事
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 新聞 */}
      <section className="section section--cream">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">News &amp; Media</div>
            <h2 className="section-head__title">最新消息與報導</h2>
          </div>

          {news.length ? (
            <div className="grid grid--news" style={{ gap: '0 48px' }}
                 {...editable('最新消息與報導', '/admin/news')}>
              {news.map((n) => (
                <Link to={`/news/${n.id}`} key={n.id} className="news-item" style={{ gridTemplateColumns: '1fr' }}>
                  <div>
                    <span className={`news-tag${n.category === 'media' ? ' news-tag--media' : ''}`}>
                      {n.category === 'media' ? '媒體報導' : '最新消息'}
                    </span>
                    <span className="news-item__date" style={{ marginLeft: 12 }}>
                      {formatDate(n.published_at)}
                    </span>
                    <h3 className="news-item__title">{n.title}</h3>
                    <p className="news-item__summary">{n.summary}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">尚未發布消息</div>
              <p>工作人員可於後台「新聞管理」新增最新消息與媒體報導。</p>
            </div>
          )}

          <div className="text-center" style={{ marginTop: 40 }}>
            <Link to="/news" className="btn btn--outline">查看全部消息</Link>
          </div>
        </div>
      </section>

      {/* 聯絡 CTA */}
      <section className="section section--dark">
        <div className="container text-center">
          <div className="section-head" style={{ marginBottom: 24 }}>
            <div className="section-head__eyebrow" style={{ color: 'var(--honey-300)' }}>Contact</div>
            <h2 className="section-head__title">大量訂購或有任何問題</h2>
            <p className="section-head__desc">歡迎透過 LINE 或電話直接聯絡我們，我們會盡快回覆</p>
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/contact" className="btn btn--light">查看聯絡方式</Link>
            {settings.line_url && (
              <a href={settings.line_url} target="_blank" rel="noreferrer" className="btn btn--outline"
                 style={{ borderColor: 'var(--honey-300)', color: 'var(--honey-200)' }}>
                加入 LINE 好友
              </a>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
