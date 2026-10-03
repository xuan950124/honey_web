import {
  ContactChannels, ContactFaq, ContactHeader, ContactLine, ContactMap, ContactNotice,
} from '../components/sections/ContactSections'

export default function Contact() {
  return (
    <>
      <ContactHeader />

      <section className="section">
        <div className="container">
          <div className="contact-grid">
            <div><ContactChannels /></div>
            <div className="contact-grid__side">
              <ContactLine />
              <div><ContactMap /></div>
            </div>
          </div>
        </div>
      </section>

      {/* 訂購須知＝標籤資訊面上的「保存方法、注意事項」那一類資訊，所以放在蜂蜜黃的面上 */}
      <section className="section section--honey">
        <div className="container"><ContactNotice /></div>
      </section>

      {/* 常見問題同時是給客人看的內容，也是 Google 會展開在搜尋結果裡的資料 */}
      <section className="section">
        <div className="container container--narrow"><ContactFaq /></div>
      </section>
    </>
  )
}
