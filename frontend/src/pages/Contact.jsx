import {
  ContactChannels, ContactFaq, ContactHeader, ContactLine, ContactMap, ContactNotice,
} from '../components/sections/ContactSections'

export default function Contact() {
  return (
    <>
      <section className="page-hero">
        <div className="container"><ContactHeader /></div>
      </section>

      <section className="section">
        <div className="container">
          <div className="contact-grid">
            <div><ContactChannels /></div>
            <div>
              <ContactLine />
              <div style={{ marginTop: 26 }}><ContactMap /></div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--cream">
        <div className="container"><ContactNotice /></div>
      </section>

      {/* 常見問題同時是給客人看的內容，也是 Google 會展開在搜尋結果裡的資料 */}
      <section className="section">
        <div className="container"><ContactFaq /></div>
      </section>
    </>
  )
}
