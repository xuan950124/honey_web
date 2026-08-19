import { ProductsGrid, ProductsHeader } from '../components/sections/PageSections'

export default function Products() {
  return (
    <>
      <section className="page-hero">
        <div className="container"><ProductsHeader /></div>
      </section>

      <section className="section">
        <div className="container"><ProductsGrid /></div>
      </section>
    </>
  )
}
