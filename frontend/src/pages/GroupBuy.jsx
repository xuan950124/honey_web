import {
  GroupFaq, GroupHeader, GroupIntro, GroupPackages, GroupSteps,
} from '../components/sections/PageSections'

export default function GroupBuy() {
  return (
    <>
      <section className="page-hero">
        <div className="container"><GroupHeader /></div>
      </section>

      <section className="section">
        <div className="container"><GroupIntro /></div>
      </section>

      <section className="section--tight">
        <div className="container"><GroupSteps /></div>
      </section>

      <section className="section section--cream">
        <div className="container"><GroupPackages /></div>
      </section>

      <section className="section">
        <div className="container"><GroupFaq /></div>
      </section>
    </>
  )
}
