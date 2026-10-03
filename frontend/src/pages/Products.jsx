import { ProductsGrid, ProductsHeader } from '../components/sections/PageSections'

export default function Products() {
  return (
    <>
      <ProductsHeader />

      <section className="section">
        <div className="container"><ProductsGrid /></div>
      </section>
    </>
  )
}
