import beeSvg from '../assets/brand/bee.svg?raw'
import bloomSvg from '../assets/brand/hero-cleyera.svg?raw'
import schefUrl from '../assets/brand/hero-schefflera.svg?url'

/**
 * 品牌素材：全部從店家的標籤完稿（蜂蜜貼紙_完稿.pdf）拆出來，不是另外畫或另外找字體。
 *
 * - 品牌字與 Logo（public/brand/*.svg）用 CSS mask 上色：同一個檔案，
 *   放在珊瑚紅上是墨色、放在墨色頁尾上是蜂蜜黃，不必存好幾份不同顏色的圖。
 *   顏色跟著 color（currentColor）走，比例寫在 styles.css 的 .lettering--* 裡。
 * - 首頁的開花枝條與蜜蜂要做動畫（枝幹長出來、花一朵朵開、蜜蜂飛進來），
 *   所以直接把 SVG 放進頁面裡（src/assets/brand），CSS 才控制得到每一朵花。
 *   紅淡比、鴨腳木各一張（hero-cleyera.svg、hero-schefflera.svg），主視覺可以切換。
 *   這兩個檔案是我們自己的素材，不含任何使用者輸入，可以安全地直接插入。
 */

/**
 * 品牌字（單色）。
 * name：logo（基隆地圖花＋蜜蜂）、seal（圓形貼紙）、keelung（KEELUNG SPECIALTY 直排）、
 *       techan（基隆特產）、wordmark-zh（黃家基蜜）、wordmark-en（Huang's Keelung Honey）、
 *       tagline（100% Natural Forest Product）、title-cleyera／title-schefflera（花系標題）、
 *       series-cleyera／series-schefflera（Mori Cleyera Series 等）
 * label：要讓螢幕閱讀器讀出來時才給；純裝飾就不給（整個略過）。
 */
export function Lettering({ name, label, className = '', ...rest }) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' }
  return <span className={`lettering lettering--${name}${className ? ` ${className}` : ''}`} {...a11y} {...rest} />
}

/** 首頁主視覺的紅淡比開花枝條（分層：枝幹、葉子、花苞、花＋花蕊）。 */
export function BloomArt({ className = '' }) {
  return (
    <div className={`bloom-art${className ? ` ${className}` : ''}`} aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: bloomSvg }} />
  )
}

/**
 * 鴨腳木的開花枝條（分層：兩片大葉、枝幹、小葉、小花、花粉點）。
 * 只有客人在主視覺切到鴨腳木時才需要，所以不放進第一次下載的程式裡，用到時才下載（之後會記住）。
 *
 * 用 fetch 抓靜態檔，不用 import()：import() 失敗一次，瀏覽器會記住失敗、之後都不再重抓；
 * fetch 失敗了，客人再按一次就會重新下載。同一時間只會有一個下載在跑。
 */
let schefSvg = null
let schefLoading = null
/** 已經下載好的話直接拿到（沒有就是 null），不用等。 */
export const peekSchefArt = () => schefSvg
export function loadSchefArt() {
  if (schefSvg) return Promise.resolve(schefSvg)
  if (!schefLoading) {
    schefLoading = fetch(schefUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`鴨腳木插畫下載失敗（HTTP ${res.status}）`)
        return res.text()
      })
      .then((text) => {
        // 網址錯了伺服器可能回首頁的 HTML；不是 SVG 就不要放進頁面
        if (!text.trimStart().startsWith('<svg')) throw new Error('鴨腳木插畫的內容不是 SVG')
        schefSvg = text
        return text
      })
      .finally(() => { schefLoading = null })
  }
  return schefLoading
}

export function SchefArt({ svg, className = '' }) {
  if (!svg) return null
  return (
    <div className={`bloom-art${className ? ` ${className}` : ''}`} aria-hidden="true"
         dangerouslySetInnerHTML={{ __html: svg }} />
  )
}

/** 標籤上那隻蜜蜂（翅膀單獨一層，飛的時候會拍動）。 */
export function Bee({ className = '' }) {
  return (
    <span className={`bee-art${className ? ` ${className}` : ''}`} aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: beeSvg }} />
  )
}

/**
 * 標籤「注意事項」每一行前面的 ◎（雙圈）。
 * 用 SVG 畫，不用文字符號：不同手機的字型裡 ◎ 長得不一樣，有的還會變成彩色的表情符號。
 */
export function NoteMark({ className = '' }) {
  return (
    <svg className={`note-mark${className ? ` ${className}` : ''}`} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="10" cy="10" r="4.1" fill="none" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  )
}
