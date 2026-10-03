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
export default function Home() {
  return (
    <>
      <HomeHero />

      <section className="section info-band">
        <div className="container"><HomeInfo /></div>
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
