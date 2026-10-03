import {
  GroupFaq, GroupHeader, GroupIntro, GroupPackages, GroupSteps,
} from '../components/sections/PageSections'

export default function GroupBuy() {
  return (
    <>
      <GroupHeader />

      <section className="section">
        <div className="container"><GroupIntro /></div>
      </section>

      <section className="section section--flush-top">
        <div className="container"><GroupSteps /></div>
      </section>

      {/* 團購組合放在紅淡比標籤的正面（珊瑚紅）上：組合裡的都是紅淡蜜 */}
      <section className="section section--coral">
        <div className="container"><GroupPackages /></div>
      </section>

      <section className="section">
        <div className="container container--narrow"><GroupFaq /></div>
      </section>
    </>
  )
}
