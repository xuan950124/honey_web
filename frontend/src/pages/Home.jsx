import { useEffect, useRef, useState } from 'react'
import { Bee } from '../components/Brand'
import {
  HomeCta, HomeGroupBuy, HomeHero, HomeInfo, HomeNews, HomeProducts, HomeSeries, HomeStory,
} from '../components/sections/HomeSections'

/**
 * 首頁。
 *
 * 內容拆在 components/sections/HomeSections.jsx，這裡只負責把它們
 * 依序疊起來、決定每一段的底色與留白。拆開純粹是為了好讀 ——
 * 一整頁的 JSX 混在一起，改一個文案要捲很久才找得到。
 *
 * 順序照方向說明的故事走：花長出來、蜜蜂飛進來 → 認得這兩張標籤 → 相信是自家蜂場的真蜜 → 選購或團購。
 *
 * 色場的節奏照店家的標籤走，每一段像標籤的一個面：
 * 珊瑚紅（主視覺，紅淡比的正面；客人可以切成鴨腳木的天空藍）→ 蜂蜜黃（資訊面：營養標示式的三項事實、蜂場照、◎ 四個承諾）
 * → 墨色（森林野花蜜：兩張標籤像貼在桌上）→ 白（精選蜂蜜）
 * → 蜂蜜黃（團購；團購組合都是紅淡蜜，所以用紅淡比標籤的資訊面，不用鴨腳木的天空藍）
 * → 白（故事、消息）→ 珊瑚紅（聯絡）→ 墨色（頁尾）。
 * 天空藍與檸檬黃綠是鴨腳木標籤的顏色，只留給鴨腳木花系。
 */
/*
  預覽用（店家選定之後整段拿掉）：網址加上 ?info= 才會在資訊帶上方出現一排切換鈕，
  一般客人看到的首頁不變。店家可以在正式站上用自己的照片、電腦跟手機都切換看看。
*/
const INFO_PREVIEWS = [
  { key: 'now', label: '現在', cls: '' },
  { key: 'a', label: 'A 標籤兩面', cls: 'info-band--a' },
  { key: 'b', label: 'B 照片鋪滿', cls: 'info-band--b' },
  { key: 'c', label: 'C 框成標籤', cls: 'info-band--c' },
  { key: 'd', label: 'D 全景＋貼紙', cls: 'info-band--d' },
  { key: 'e1', label: 'E1 花白混色', cls: 'info-band--e info-band--tone-bloom' },
  { key: 'e2', label: 'E2 蜂蜜黃混色', cls: 'info-band--e info-band--tone-honey' },
  { key: 'e3', label: 'E3 白底＋橘', cls: 'info-band--e info-band--tone-paper' },
  { key: 'e4', label: 'E4 森林綠', cls: 'info-band--e info-band--tone-forest' },
]
const readPreview = () => {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get('info')
  if (v === null) return null
  return INFO_PREVIEWS.some((p) => p.key === v) ? v : 'now'
}

function InfoPreviewBar({ value, onChange }) {
  // 手機上按鈕排不下會橫向捲動：把選中的那顆捲到中間（只動這一排，不動整頁）
  const listRef = useRef(null)
  useEffect(() => {
    const list = listRef.current
    const btn = list?.querySelector('[aria-pressed="true"]')
    if (list && btn) list.scrollLeft = btn.offsetLeft - (list.clientWidth - btn.clientWidth) / 2
  }, [value])
  return (
    <div className="info-preview" role="group" aria-label="首頁資訊帶的版本（預覽用，客人看不到）">
      <div className="container info-preview__inner">
        <span className="info-preview__label">資訊帶預覽</span>
        <div className="info-preview__list" ref={listRef}>
          {INFO_PREVIEWS.map((p) => (
            <button key={p.key} type="button" className="info-preview__btn"
                    aria-pressed={value === p.key} onClick={() => onChange(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  const [preview, setPreview] = useState(readPreview)
  const choose = (key) => {
    setPreview(key)
    // 網址跟著換，重新整理或傳給別人看都會停在同一個版本
    const url = new URL(window.location.href)
    url.searchParams.set('info', key)
    window.history.replaceState(window.history.state, '', url)
  }
  const infoClass = INFO_PREVIEWS.find((p) => p.key === preview)?.cls || ''
  return (
    <>
      <HomeHero />

      {preview && <InfoPreviewBar value={preview} onChange={choose} />}
      <section className={`section info-band${infoClass ? ` ${infoClass}` : ''}`}>
        <div className="container"><HomeInfo traceLink={Boolean(preview)} /></div>
      </section>

      <section className="section series-band">
        <div className="container"><HomeSeries /></div>
      </section>

      <section className="section">
        <div className="container"><HomeProducts /></div>
      </section>

      <section className="group-band">
        <div className="container"><HomeGroupBuy /></div>
      </section>

      {/* 沒有故事時 HomeStory 什麼都不畫，這一段會由 CSS 整段收起來 */}
      <section className="section">
        <div className="container"><HomeStory /></div>
      </section>

      <section className="section section--ruled">
        <div className="container"><HomeNews /></div>
      </section>

      <section className="cta-band">
        {/* 主視覺那隻蜜蜂一路飛到這裡，停在一朵紅淡比的花旁邊（純裝飾） */}
        <div className="cta-band__art" aria-hidden="true">
          <img className="cta-band__flower" src="/brand/flower.svg" alt="" loading="lazy" />
          <Bee className="cta-band__bee" />
        </div>
        <div className="container"><HomeCta /></div>
      </section>
    </>
  )
}
