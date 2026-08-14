import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import ProductCard from '../components/ProductCard'

export default function Products() {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [params, setParams] = useSearchParams()
  const active = params.get('category') || ''

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    api
      .listProducts({ category: active || undefined })
      .then(setProducts)
      .catch(() => setProducts([]))
      .finally(() => setLoading(false))
  }, [active])

  const visible = useMemo(() => products.filter((p) => !p.is_group_buy || active), [products, active])

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">蜂蜜商品</h1>
          <p className="page-hero__desc">依花期分批採收裝瓶，每一批的色澤與風味都略有不同</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="filter-bar">
            <button
              type="button"
              className={`chip${active === '' ? ' active' : ''}`}
              onClick={() => setParams({})}
            >
              全部商品
            </button>
            {categories.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`chip${active === c.slug ? ' active' : ''}`}
                onClick={() => setParams({ category: c.slug })}
              >
                {c.name}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="loading">載入商品中…</div>
          ) : visible.length ? (
            <div className="grid grid--4">
              {visible.map((p) => <ProductCard key={p.id} product={p} />)}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-state__title">這個分類目前沒有商品</div>
              <p>工作人員可於後台「商品管理」新增商品。</p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}
