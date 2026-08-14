import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, formatPrice } from '../../api/client'
import Placeholder from '../../components/Placeholder'

export default function AdminProducts() {
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = () => {
    setLoading(true)
    api
      .listProducts({ include_inactive: true })
      .then(setProducts)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const remove = async (p) => {
    if (!window.confirm(`確定要刪除「${p.name}」嗎？此動作無法復原。`)) return
    try {
      await api.deleteProduct(p.id)
      load()
    } catch (e) {
      setErr(e.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">商品管理</h1>
        <Link to="/admin/products/new" className="btn btn--primary">＋ 新增商品</Link>
      </div>

      {err && <div className="alert alert--error">{err}</div>}

      <div className="panel" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading">載入中…</div>
        ) : products.length ? (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>照片</th>
                  <th>商品名稱</th><th>分類</th><th>售價</th><th>庫存</th><th>標記</th><th>狀態</th>
                  <th style={{ width: 130 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td><div style={{ width: 48 }}><Placeholder src={p.image_url} ratio="1x1" alt={p.name} /></div></td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{p.name}</div>
                      {p.spec && <div className="small muted">{p.spec}</div>}
                    </td>
                    <td className="small">{p.category?.name || '－'}</td>
                    <td>NT${formatPrice(p.price)}</td>
                    <td>{p.stock}</td>
                    <td>
                      {p.is_group_buy && <span className="tag tag--staff" style={{ marginRight: 4 }}>團購</span>}
                      {p.is_featured && <span className="tag tag--member">精選</span>}
                    </td>
                    <td>
                      <span className={`tag tag--${p.is_active ? 'shipped' : 'cancelled'}`}>
                        {p.is_active ? '上架中' : '已下架'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Link to={`/admin/products/${p.id}`} className="btn btn--ghost btn--sm">編輯</Link>
                        <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(p)}>刪除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state__title">還沒有商品</div>
            <Link to="/admin/products/new" className="btn btn--primary" style={{ marginTop: 14 }}>新增第一項商品</Link>
          </div>
        )}
      </div>
    </>
  )
}
