import {
  ContactChannels, ContactHeader, ContactLine, ContactMap, ContactNotice,
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
    </>
  )
}
