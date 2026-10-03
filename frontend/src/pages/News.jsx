import { NewsHeader, NewsList } from '../components/sections/PageSections'

export default function News() {
  return (
    <>
      <NewsHeader />

      <section className="section">
        <div className="container container--medium"><NewsList /></div>
      </section>
    </>
  )
}
