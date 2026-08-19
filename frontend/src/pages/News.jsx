import { NewsHeader, NewsList } from '../components/sections/PageSections'

export default function News() {
  return (
    <>
      <section className="page-hero">
        <div className="container"><NewsHeader /></div>
      </section>

      <section className="section">
        <div className="container"><NewsList /></div>
      </section>
    </>
  )
}
