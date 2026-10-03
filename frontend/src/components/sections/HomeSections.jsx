import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { api, formatDate } from '../../api/client'
import { Bee, BloomArt, Lettering, loadSchefArt, NoteMark, peekSchefArt, SchefArt } from '../Brand'
import Icon from '../Icon'
import Placeholder from '../Placeholder'
import ProductCard from '../ProductCard'
import TraceStamp from '../TraceStamp'
import { SectionHead } from './Common'
import { useAuth } from '../../context/AuthContext'
import { editable } from '../../context/EditModeContext'
import { useSettings } from '../../context/SettingsContext'
import { prose, stripEditorNotes } from '../../lib/text'

/**
 * 首頁的每一區。
 *
 * 拆成獨立元件純粹是為了好讀：一整頁的 JSX 混在一起，
 * 改一句文案要捲很久才找得到，而且每一區的資料抓取會全部糊在
 * 同一個 useEffect 裡。
 *
 * ## 為什麼每一區自己抓自己的資料
 *
 * 這樣一區的 API 掛掉不會拖垮整頁 —— 商品拿不到就顯示空狀態，
 * 最新消息照樣畫得出來。統一在 Home 裡抓的話，一支失敗就整頁空白。
 *
 * ## 外層的 <section> 由 Home.jsx 決定
 *
 * 底色與留白集中在 Home.jsx 看得到，不必逐一打開每個元件比對。
 * 唯一的例外是主視覺：它自己就是一整片珊瑚紅的色場（像標籤的正面）。
 */

const SETTINGS = '/admin/settings'

const HERO = {
  title: '基隆山裡',
  highlight: '等熟成才採的蜜',
  desc: '蜂場就在基隆七堵的山上。我們等蜜在巢裡封蓋、熟成了才採，裝瓶前不加水、不加糖。'
    + '每一瓶都查得到生產者是誰 —— 農業部的溯源編號就印在上面。',
}

const FEATURES = [
  { title: '自家蜂場直送', desc: '蜂場就在基隆七堵，採收後就近裝瓶出貨，不經過中盤。' },
  { title: '熟成才採收', desc: '等蜜在巢裡封蓋熟成才採，裝瓶前不加水、不加糖、不調味。' },
  { title: '政府溯源可查', desc: '已登錄農業部農糧署溯源系統，掃碼就查得到生產者是誰。' },
  // 這裡不能寫「開立發票」。自產自銷的養蜂場免辦營業登記、沒有統編，
  // 開不出統一發票 —— 而公司行號團購最在意的就是報帳憑證，寫錯會直接變客訴。
  { title: '團購可客製', desc: '社團、公司行號大量訂購可分裝寄送、客製標籤，並開立農民收據。' },
]

// 開場動畫（枝幹長出來、花一朵朵開、蜜蜂飛進來）每次開網站只播一次；之後回到首頁直接顯示開好的樣子
let heroPlayed = false
const reducedMotion = () => typeof window !== 'undefined'
  && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)

/**
 * 主視覺可以切換花系：紅淡比（珊瑚紅＋紅淡比的花）／鴨腳木（天空藍＋鴨腳木的花）。
 * 預設是紅淡比——現在在賣的都是紅淡蜜。切到鴨腳木時插畫重新長一次（比開場快），
 * 按鈕換成「即將推出」（有填上市時間就顯示），不讓客人以為現在就買得到鴨腳木。
 * 只換主視覺；其他頁面照商品自己的花系。
 *
 * 換的方式像貼一張新標籤：新的那一面從左緣（直排字那一邊）一路蓋過去，邊緣是直的，跟標籤一樣。
 * 用瀏覽器的 View Transitions：整個畫面先拍一張定格，新畫面從左往右露出來。
 * 畫面上只有主視覺不一樣，所以看起來就是主視覺在換；新畫面是即時的，插畫照樣在長。
 * 不直接漸變底色 —— 珊瑚紅漸變到天空藍，中間會經過一段灰濁的顏色。
 * 瀏覽器不支援、或客人開了「減少動態效果」時就直接換。
 */

const HERO_SERIES = [
  { key: 'cleyera', name: '紅淡比' },
  { key: 'schefflera', name: '鴨腳木' },
]

export function HomeHero() {
  const { settings, loaded } = useSettings()
  const { isStaff } = useAuth()
  const highlight = settings.hero_highlight || HERO.highlight
  const launch = (settings.series_schefflera_launch || '').trim()
  // armed：花還沒開（插畫先藏著）；growing：開場動畫播放中（播完就停在最後的樣子）；done：直接顯示
  const [phase, setPhase] = useState(() => (heroPlayed || reducedMotion() ? 'done' : 'armed'))
  const [series, setSeries] = useState('cleyera')
  const [schefSvg, setSchefSvg] = useState(peekSchefArt)
  // 客人自己切換花系時，插畫用比較快的節奏重新長出來（開場那次是完整的速度）
  const [quick, setQuick] = useState(false)
  // 鴨腳木的插畫還在下載：那顆按鈕的圓點先轉圈，下載好才換
  const [pending, setPending] = useState(null)
  const want = useRef('cleyera')
  const alive = useRef(true)
  const heroRef = useRef(null)
  useEffect(() => () => { alive.current = false }, [])

  const apply = (next, svg) => {
    if (svg) setSchefSvg(svg)
    setPending(null)
    setSeries(next)
    if (reducedMotion()) {
      setPhase('done')
    } else {
      setQuick(true)
      setPhase('armed')
    }
  }
  const switchTo = (next, svg) => {
    if (reducedMotion() || typeof document.startViewTransition !== 'function') {
      apply(next, svg)
      return
    }
    // 貼上去的樣式只掛在換花系的這一下，免得以後別的轉場也套到
    const html = document.documentElement
    html.classList.add('is-hero-wash')
    const done = () => html.classList.remove('is-hero-wash')
    try {
      const t = document.startViewTransition(() => flushSync(() => apply(next, svg)))
      // 被下一次切換打斷時 ready 會被拒絕；接住，不要在主控台留錯誤
      t.ready.catch(() => {})
      t.finished.then(done, done)
    } catch {
      done()
      apply(next, svg)
    }
  }
  const choose = (next) => {
    want.current = next
    if (next === series) {
      setPending(null)  // 下載中又按回原本那個：取消
      return
    }
    // 已經預先下載好（滑過按鈕、或開場後閒下來時）就直接換
    const ready = schefSvg || peekSchefArt()
    if (next === 'schefflera' && !ready) {
      setPending(next)
      loadSchefArt()
        .then((svg) => {
          if (alive.current && want.current === next) switchTo(next, svg)
        })
        .catch(() => {
          // 下載失敗：按鈕回到原樣，再按一次會重新下載
          if (alive.current) setPending(null)
        })
      return
    }
    switchTo(next, next === 'schefflera' ? ready : undefined)
  }
  // 滑鼠移到「鴨腳木」上（或用鍵盤移過去）就先下載插畫，按下去時通常已經好了
  const prefetch = () => { loadSchefArt().catch(() => {}) }

  // 手機沒有「移過去」：開場播完、瀏覽器閒下來時先把鴨腳木的插畫抓好（約 14 KB），點了馬上換
  useEffect(() => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200))
    const timer = setTimeout(() => idle(prefetch), 4000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (phase !== 'armed') return undefined
    let cancelled = false
    const start = () => {
      if (cancelled) return
      heroPlayed = true
      setPhase('growing')
    }
    // 等字體載好才開始：大標換字型時版面會動，動畫不要播在那一瞬間
    const ready = document.fonts?.ready ?? Promise.resolve()
    ready.then(() => requestAnimationFrame(start))
    const fallback = setTimeout(start, 1500)
    return () => { cancelled = true; clearTimeout(fallback) }
  }, [phase])

  // 捲動時插畫的幾層用不同速度移動（遠的慢、近的快），只在電腦上、沒有「減少動態效果」時做。
  // 直接改每一層自己的 transform，不經過 CSS 變數 —— 改變數會讓底下所有元素重算樣式。
  useEffect(() => {
    const el = heroRef.current
    if (!el || !window.matchMedia) return undefined
    if (!window.matchMedia('(min-width: 1001px) and (pointer: fine) and (prefers-reduced-motion: no-preference)').matches) {
      return undefined
    }
    const layers = [...el.querySelectorAll('[data-depth]')]
    let frame = 0
    const update = () => {
      frame = 0
      const y = Math.min(window.scrollY, el.offsetHeight)
      for (const layer of layers) {
        layer.style.transform = `translate3d(0, ${(y * Number(layer.dataset.depth)).toFixed(1)}px, 0)`
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
    window.addEventListener('scroll', onScroll, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
      for (const layer of layers) layer.style.transform = ''
    }
  }, [])

  return (
    <section className={`home-hero home-hero--${series} is-${phase}${quick ? ' is-switch' : ''}`} ref={heroRef}>
      {/* 標籤左緣那排直排字（基隆特產／KEELUNG SPECIALTY），從完稿拆出來的向量字 */}
      <div className="hero__ks" data-depth="0.05">
        <Lettering name="techan" className="hero__techan" />
        <Lettering name="keelung" className="hero__keelung" label="Keelung Specialty 基隆特產" />
      </div>

      <div className="container hero">
        <div className="hero__copy">
          <div className="hero__series" role="group" aria-label="切換花系">
            {HERO_SERIES.map((s) => (
              <button key={s.key} type="button"
                      className={`series-switch series-switch--${s.key}${pending === s.key ? ' is-busy' : ''}`}
                      aria-pressed={series === s.key} aria-busy={pending === s.key || undefined}
                      onClick={() => choose(s.key)}
                      onMouseEnter={s.key === 'schefflera' ? prefetch : undefined}
                      onFocus={s.key === 'schefflera' ? prefetch : undefined}>
                <span className="series-switch__dot" aria-hidden="true" />{s.name}
              </button>
            ))}
          </div>
          <h1 className="hero__title"
              {...editable('首頁大標', SETTINGS, 'hero_title', '兩行大字，整個網站最先被看到的一句話。第二行在後台是「首頁大標（第二行）」。')}>
            <span className="hero__line">{settings.hero_title || HERO.title}</span>
            <span className="hero__line">{highlight}</span>
          </h1>
          <p className={`hero__desc${loaded ? '' : ' is-pending'}`}
             {...editable('首頁說明文', SETTINGS, 'hero_desc', '頁尾的品牌介紹也會用這一段。')}>
            {prose(settings.hero_desc || HERO.desc)}
          </p>
          {series === 'cleyera' ? (
            <div className="hero__actions">
              <Link to="/products" className="btn btn--primary btn--lg">選購蜂蜜<Icon name="arrow" /></Link>
              <Link to="/group-buy" className="btn btn--outline btn--lg">團購方案</Link>
            </div>
          ) : (
            <div className="hero__actions hero__actions--soon">
              <span className="sticker sticker--soon hero__soon">即將推出</span>
              {(launch || isStaff) && (
                <span className="hero__launch"
                      {...editable('鴨腳木花系上市時間', SETTINGS, 'series_schefflera_launch', '寫月份或季節就好。留空時客人只會看到「即將推出」。')}>
                  上市時間：{launch || <span className="todo">待填</span>}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 右邊：標籤上的開花枝條放大（紅淡比或鴨腳木），蜜蜂停在花旁，溯源貼紙斜貼在左下角 */}
      <div className="hero__stage">
        <div className="hero__layer" data-depth="0.1">
          {series === 'cleyera'
            ? <BloomArt className="hero__bloom" />
            : <SchefArt svg={schefSvg} className="hero__bloom" />}
        </div>
        <div className="hero__layer hero__layer--bee" data-depth="-0.05">
          <span className="hero__bee"><span className="hero__bee-y"><Bee /></span></span>
        </div>
        <TraceStamp variant="seal" className="hero__seal" />
      </div>
    </section>
  )
}

/**
 * 主視覺底下那一片蜂蜜黃：標籤右邊印資訊的那一面。
 *
 * 三項事實照標籤上「營養標示」那張表的樣子排：一圈墨色細框，左邊項目、右邊數值，細線分列
 * （字都是原本網站上的那三組，沒有另外加標題）。
 * 旁邊是蜂場實景照；四個承諾用標籤「注意事項」每行開頭的 ◎。
 */
export function HomeInfo() {
  const { settings } = useSettings()
  return (
    <div className="info-face">
      <figure className="info-face__media"
              {...editable('首頁蜂場照片', SETTINGS, 'hero_image_url', '首頁資訊面左邊這張照片（後台叫「首頁主視覺」）。橫式、至少 1600 像素寬，蜂場或蜂箱的實景照最有說服力；照片保持原色。')}>
        <Placeholder
          src={settings.hero_image_url}
          ratio="4x3"
          art="apiary"
          alt="基隆七堵的自家蜂場"
          hint={'蜂場實景照\n（後台「網站設定 → 圖片 → 首頁主視覺」上傳）'}
        />
      </figure>
      <div className="info-face__text">
        <dl className="label-table facts-table">
          <div><dt>七堵自家蜂場</dt><dd>基隆</dd></div>
          <div><dt>人工添加物</dt><dd>0</dd></div>
          <div><dt>農業部追溯編號</dt><dd>可溯源</dd></div>
        </dl>
        <ul className="notes"
            {...editable('品牌四大特色', SETTINGS, null, '這四項目前寫在程式碼裡，後台改不了。要調整請跟我說要換成哪四點。')}>
          {FEATURES.map((f) => (
            <li className="note" key={f.title}>
              <NoteMark className="note__mark" />
              <h3 className="note__title">{f.title}</h3>
              <p className="note__desc">{f.desc}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function HomeProducts() {
  const [items, setItems] = useState([])
  useEffect(() => {
    api.listProducts({ featured: true }).then((d) => setItems(d.slice(0, 4))).catch(() => {})
  }, [])

  return (
    <>
      <SectionHead
        title="精選蜂蜜"
        desc="基隆山區採收，依花期分批裝瓶，每一批的顏色與香氣都略有不同"
      />
      {items.length ? (
        <div className="grid grid--4 grid--products"
             {...editable('首頁精選商品', '/admin/products', null, '在商品管理裡把商品勾選「首頁精選」，就會出現在這一區。')}>
          {items.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__title">尚未設定精選商品</div>
          <p>工作人員登入後台後，將商品勾選「首頁精選」即會顯示於此。</p>
        </div>
      )}
      <div className="section-foot">
        <Link to="/products" className="btn btn--outline">查看全部商品<Icon name="arrow" /></Link>
      </div>
    </>
  )
}

/**
 * 花系介紹：標籤上的兩個花系。
 *
 * 紅淡比花系就是網站上在賣的「森林紅淡蜜」；鴨腳木花系還沒上架，標「即將推出」。
 * 每個花系的介紹文字與鴨腳木的上市時間由店家在後台填（網站設定 → 首頁花系介紹），
 * 沒填之前客人看不到空白，工作人員才看得到「待填」。
 * 品名、成分、原產地照標籤上印的字寫，不另外編。
 */
const SERIES = [
  {
    key: 'cleyera',
    name: '紅淡比花系',
    product: '森林野花蜜（紅淡比花系）',
    desc: 'series_cleyera_desc',
    available: true,
  },
  {
    key: 'schefflera',
    name: '鴨腳木花系',
    product: '森林野花蜜（鴨腳木花系）',
    desc: 'series_schefflera_desc',
    launch: 'series_schefflera_launch',
    available: false,
  },
]

export function HomeSeries() {
  const { settings } = useSettings()
  const { isStaff } = useAuth()
  const ref = useReveal()

  return (
    <div className="series-wrap" ref={ref}>
      <div className="series-head">
        <h2 className="series-head__title">森林野花蜜</h2>
        <Lettering name="tagline" className="series-head__tagline" label="100% Natural Forest Product" />
      </div>
      <div className="series">
        {SERIES.map((s) => {
          const desc = (settings[s.desc] || '').trim()
          const launch = s.launch ? (settings[s.launch] || '').trim() : ''
          return (
            <article className={`series-card series-card--${s.key}`} key={s.key}>
              <div className="series-card__label">
                <img src={`/brand/label-${s.key}.svg`} alt={`${s.name}的標籤`} width="623" height="482" loading="lazy" />
                {!s.available && <span className="sticker sticker--soon series-card__soon">即將推出</span>}
              </div>
              <div className="series-card__body">
                <h3 className="series-card__name">{s.name}</h3>
                <dl className="series-card__facts">
                  <div><dt>品名</dt><dd>{s.product}</dd></div>
                  <div><dt>成分</dt><dd>100%純蜂蜜</dd></div>
                  <div><dt>原產地</dt><dd>台灣基隆山區</dd></div>
                  {s.launch && (launch || isStaff) && (
                    <div {...editable(`${s.name}上市時間`, SETTINGS, s.launch, '寫月份或季節就好。留空時客人只會看到「即將推出」。')}>
                      <dt>上市時間</dt><dd>{launch || <span className="todo">待填</span>}</dd>
                    </div>
                  )}
                </dl>
                {(desc || isStaff) && (
                  <p className="series-card__desc"
                     {...editable(`${s.name}介紹`, SETTINGS, s.desc, '兩三句話介紹這個花系的蜜（花期、顏色、香氣）。留空時這一段不顯示。')}>
                    {desc ? prose(desc) : <span className="todo">介紹文字待填</span>}
                  </p>
                )}
                {s.available && (
                  <Link to="/products" className="btn btn--primary">選購蜂蜜<Icon name="arrow" /></Link>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 捲到時把兩張標籤「貼上去」（由下往上露出）。
 * 一開始就在畫面裡、或設定了減少動態效果時不做，直接顯示 —— 內容永遠不會因為動畫而看不到。
 */
function useReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reducedMotion() || typeof IntersectionObserver === 'undefined') return undefined
    if (el.getBoundingClientRect().top < window.innerHeight * 0.85) return undefined
    el.classList.add('is-armed')
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      el.classList.add('is-revealed')
      io.disconnect()
    }, { rootMargin: '0px 0px -18% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return ref
}

export function HomeGroupBuy() {
  const [items, setItems] = useState([])
  useEffect(() => {
    api.listProducts({ group_buy: true }).then((d) => setItems(d.slice(0, 3))).catch(() => {})
  }, [])

  return (
    <div className="group-band__grid">
      <div className="group-band__copy">
        <h2 className="group-band__title">團購專區</h2>
        <p className="group-band__desc">公司行號、社區揪團、幼兒園採購，可分裝與客製標籤</p>
        <Link to="/group-buy" className="btn btn--primary">了解團購方案<Icon name="arrow" /></Link>
        {/*
          紅淡比的花枝從色面底邊長上來（標籤上的插畫，純裝飾）。
          團購組合都是紅淡蜜，所以這一段用紅淡比標籤的顏色與花（蜂蜜黃的資訊面＋紅淡比），
          天空藍與鴨腳木留給還沒上架的鴨腳木花系，不讓客人以為團購的是鴨腳木。
        */}
        <img className="group-band__art" src="/brand/art-cleyera.svg" alt="" aria-hidden="true" loading="lazy" />
      </div>
      {items.length ? (
        <div className={`group-band__items group-band__items--${items.length}`}
             {...editable('團購商品', '/admin/products', null, '把商品勾選「團購商品」就會出現在這一區與團購專區。')}>
          {items.map((p) => (
            <ProductCard key={p.id} product={p} variant={items.length === 1 ? 'wide' : 'plate'} />
          ))}
        </div>
      ) : (
        <div className="empty-state empty-state--band">
          <div className="empty-state__title">尚未建立團購方案</div>
          <p>工作人員可於後台新增商品時勾選「團購商品」。</p>
        </div>
      )}
    </div>
  )
}

export function HomeStory() {
  const [story, setStory] = useState(null)
  useEffect(() => {
    api.listStories().then((d) => setStory(d[0] || null)).catch(() => {})
  }, [])

  if (!story) return null
  const clean = stripEditorNotes(story.content || '')

  return (
    <div className="story-feature"
         {...editable('品牌故事', '/admin/stories', null, '這裡顯示排序第一則故事的開頭 160 字。')}>
      <div className="story-feature__media">
        <Placeholder src={story.cover_url} ratio="4x3" art="apiary" alt={story.title}
                     hint={'故事照片\nstory-1.jpg'} />
      </div>
      <div className="story-feature__copy">
        <h2 className="story-feature__title">{prose(story.title)}</h2>
        {story.subtitle && <p className="story-feature__sub">{prose(story.subtitle)}</p>}
        <p className="story-feature__text">
          {prose(clean.slice(0, 160) + (clean.length > 160 ? '…' : ''))}
        </p>
        <Link to="/story" className="btn btn--outline">閱讀完整故事<Icon name="arrow" /></Link>
      </div>
    </div>
  )
}

export function HomeNews() {
  const [news, setNews] = useState([])
  useEffect(() => {
    api.listNews({ limit: 4 }).then(setNews).catch(() => {})
  }, [])

  return (
    <>
      <SectionHead title="最新消息與報導" />
      {news.length ? (
        // 最新的一則放大當頭條，其餘排成一列（最多三則），不會留下一個空角落
        <div className={`news-feature news-feature--${Math.min(Math.max(news.length - 1, 1), 3)}`}
             {...editable('最新消息與報導', '/admin/news')}>
          {news.map((n, i) => (
            <Link to={`/news/${n.id}`} key={n.id}
                  className={`news-item news-item--text${i === 0 ? ' news-item--lead' : ''}`}>
              <div className="news-item__meta">
                <span className={`news-tag${n.category === 'media' ? ' news-tag--media' : ''}`}>
                  {n.category === 'media' ? '媒體報導' : '最新消息'}
                </span>
                <span className="news-item__date">{formatDate(n.published_at)}</span>
              </div>
              <h3 className="news-item__title">{prose(n.title)}</h3>
              <p className="news-item__summary">{prose(n.summary)}</p>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <div className="empty-state__title">尚未發布消息</div>
          <p>工作人員可於後台「新聞管理」新增最新消息與媒體報導。</p>
        </div>
      )}
      <div className="section-foot">
        <Link to="/news" className="btn btn--outline">查看全部消息<Icon name="arrow" /></Link>
      </div>
    </>
  )
}

export function HomeCta() {
  const { settings } = useSettings()
  return (
    <div className="cta-band__inner">
      <h2 className="cta-band__title">大量訂購或有任何問題</h2>
      <p className="cta-band__desc">歡迎透過 LINE 或電話直接聯絡我們，我們會盡快回覆</p>
      <div className="cta-band__actions">
        <Link to="/contact" className="btn btn--ink btn--lg">查看聯絡方式</Link>
        {settings.line_url && (
          <a href={settings.line_url} target="_blank" rel="noreferrer" className="btn btn--outline btn--lg">
            加入 LINE 好友
          </a>
        )}
      </div>
    </div>
  )
}
