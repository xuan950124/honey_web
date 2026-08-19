import {
  HomeCta, HomeFeatures, HomeGroupBuy, HomeHero, HomeNews, HomeProducts, HomeStory,
} from '../components/sections/HomeSections'

/**
 * 首頁。
 *
 * 內容拆在 components/sections/HomeSections.jsx，這裡只負責把它們
 * 依序疊起來、決定每一段的底色與留白。拆開純粹是為了好讀 ——
 * 一整頁的 JSX 混在一起，改一個文案要捲很久才找得到。
 */
export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container"><HomeHero /></div>
      </section>

      <section className="section--tight">
        <div className="container"><HomeFeatures /></div>
      </section>

      <section className="section">
        <div className="container"><HomeProducts /></div>
      </section>

      <section className="section section--cream">
        <div className="container"><HomeGroupBuy /></div>
      </section>

      <section className="section">
        <div className="container"><HomeStory /></div>
      </section>

      <section className="section section--cream">
        <div className="container"><HomeNews /></div>
      </section>

      <section className="section section--dark">
        <div className="container"><HomeCta /></div>
      </section>
    </>
  )
}
