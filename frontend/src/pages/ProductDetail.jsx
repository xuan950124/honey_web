import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatPrice } from '../api/client'
import Placeholder from '../components/Placeholder'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'
import { stripEditorNotes } from '../lib/text'

export default function ProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [qty, setQty] = useState(1)
  const [mainImage, setMainImage] = useState(null)
  const { add, items } = useCart()
  const { isStaff } = useAuth()
  const { settings } = useSettings()

  useEffect(() => {
    window.scrollTo(0, 0)
    api
      .getProduct(id)
      .then((p) => {
        setProduct(p)
        setMainImage(p.image_url)
        setQty(1)
      })
      .catch((e) => setError(e.message))
  }, [id])

  if (error) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__title">{error}</div>
          <Link to="/products" className="btn btn--outline" style={{ marginTop: 16 }}>回到商品列表</Link>
        </div>
      </div>
    )
  }

  if (!product) return <div className="loading">載入中…</div>

  const gallery = [product.image_url, ...product.images.map((i) => i.image_url)].filter(Boolean)

  // 庫存上限要扣掉「已經在購物車裡」的數量，
  // 不然買家可以按三次「加入購物車」把庫存 5 組的東西加到 15 組。
  const stock = product.stock === null || product.stock === undefined ? Infinity : Math.max(0, product.stock)
  const inCart = items.find((i) => i.id === product.id)?.quantity || 0
  const room = Math.max(0, stock - inCart)
  const soldOut = stock <= 0
  const cartFull = !soldOut && room <= 0
  const maxQty = Number.isFinite(room) ? Math.max(1, room) : undefined
  const clampQty = (n) => Math.min(Math.max(1, Math.floor(Number(n) || 1)), maxQty ?? Infinity)

  return (
    <section className="section has-buy-bar">
      <div className="container">
        <div className="breadcrumb">
          <Link to="/">首頁</Link><span>/</span>
          <Link to={product.is_group_buy ? '/group-buy' : '/products'}>
            {product.is_group_buy ? '團購專區' : '蜂蜜商品'}
          </Link><span>/</span>
          {product.name}
        </div>

        <div className="pd" {...editable(`商品：${product.name}`, `/admin/products/${product.id}`)}>
          <div>
            <Placeholder
              src={mainImage}
              ratio="1x1"
              alt={product.name}
              hint={`商品主圖\nproduct-${product.id}.jpg`}
              emptyText="照片準備中"
            />
            {/* 沒有其他照片時，對客人整排隱藏 —— 四個空框看起來像壞掉 */}
            {(gallery.length > 1 || isStaff) && (
              <div className="pd__thumbs">
                {gallery.length ? (
                  gallery.map((url, i) => (
                    <button
                      key={url + i}
                      type="button"
                      onClick={() => setMainImage(url)}
                      style={{ padding: 0, border: 'none', background: 'none' }}
                    >
                      <Placeholder src={url} ratio="1x1" alt={`${product.name} 圖 ${i + 1}`} />
                    </button>
                  ))
                ) : (
                  [1, 2, 3, 4].map((n) => (
                    <Placeholder key={n} ratio="1x1" hint={`圖 ${n}`} alt="待補上照片" />
                  ))
                )}
              </div>
            )}
          </div>

          <div>
            {product.is_group_buy && (
              <span className="news-tag news-tag--media" style={{ marginBottom: 14, display: 'inline-block' }}>
                團購商品
              </span>
            )}
            <h1 className="pd__title">{product.name}</h1>
            {product.subtitle && <p className="pd__sub">{product.subtitle}</p>}

            <div className="pd__price">
              <span style={{ fontSize: 16 }}>NT$</span> {formatPrice(product.price)}
              {product.original_price && Number(product.original_price) > Number(product.price) && (
                <span className="price__old" style={{ fontSize: 15 }}>
                  NT${formatPrice(product.original_price)}
                </span>
              )}
            </div>

            <div className="pd__divider" />

            <table className="spec-table">
              <tbody>
                {product.spec && <tr><th>規格</th><td>{product.spec}</td></tr>}
                {product.origin && <tr><th>產地</th><td>{product.origin}</td></tr>}
                <tr>
                  <th>庫存</th>
                  <td>
                    {soldOut ? '補貨中' : Number.isFinite(stock) ? `尚有 ${stock} 組` : '供應中'}
                    {inCart > 0 && (
                      <span className="small muted">　（購物車裡已有 {inCart} 組）</span>
                    )}
                  </td>
                </tr>
                {product.category?.name && <tr><th>分類</th><td>{product.category.name}</td></tr>}
                {product.is_group_buy && product.group_buy_min_qty && (
                  <tr><th>成團數量</th><td>{product.group_buy_min_qty} 組起</td></tr>
                )}
              </tbody>
            </table>

            {product.group_buy_note && (
              <div className="alert alert--info" style={{ marginTop: 20 }}>
                {product.group_buy_note}
              </div>
            )}

            <div className="pd__divider" />

            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="qty">
                <button type="button" disabled={soldOut || cartFull || qty <= 1}
                        onClick={() => setQty((q) => clampQty(q - 1))}>−</button>
                <input
                  type="number" min="1" max={maxQty} value={qty}
                  onChange={(e) => setQty(clampQty(e.target.value))}
                  disabled={soldOut || cartFull}
                />
                <button type="button" disabled={soldOut || cartFull || qty >= room}
                        onClick={() => setQty((q) => clampQty(q + 1))}>＋</button>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1, minWidth: 180 }}
                disabled={soldOut || cartFull}
                onClick={() => { add(product, qty); setQty(1) }}
              >
                {soldOut ? '補貨中' : cartFull ? '購物車已達庫存上限' : '加入購物車'}
              </button>
            </div>

            {cartFull && (
              <p className="small" style={{ marginTop: 12, color: 'var(--danger)' }}>
                庫存共 {stock} 組，已全部在你的購物車裡了。
                <Link to="/cart" style={{ textDecoration: 'underline', fontWeight: 500 }}>　前往結帳</Link>
              </p>
            )}

            {settings.line_id && (
              <p className="small muted" style={{ marginTop: 18 }}>
                大量訂購或需要客製包裝，歡迎加 LINE：{settings.line_id}
                {settings.contact_phone ? `，或來電 ${settings.contact_phone}` : ''}
              </p>
            )}
          </div>
        </div>

        {product.description && (
          <div style={{ marginTop: 72, maxWidth: 760 }}>
            <h2 className="section-head__title" style={{ fontSize: 22, marginBottom: 18 }}>商品介紹</h2>
            <p style={{ whiteSpace: 'pre-line', color: 'var(--ink-soft)' }}>
              {stripEditorNotes(product.description)}
            </p>
            {/* 情境照沒上傳時整塊不顯示，不要留一個空框給客人看 */}
            {(product.images?.[1]?.image_url || isStaff) && (
              <div style={{ marginTop: 28 }}>
                <Placeholder
                  src={product.images?.[1]?.image_url}
                  fit="auto"
                  hint={`商品情境照\nproduct-${product.id}-detail.jpg`}
                  alt="商品情境照"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 手機版固定在底部的購買列，捲到哪都能直接買 */}
      <div className="buy-bar">
        <div className="buy-bar__price">
          <div className="buy-bar__label">{product.spec || '售價'}</div>
          <div className="price">
            <span className="price__cur">NT$</span>{formatPrice(product.price)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={soldOut || cartFull}
          onClick={() => { add(product, qty); setQty(1) }}
        >
          {soldOut ? '補貨中' : cartFull ? '已達庫存上限' : `加入購物車（${qty}）`}
        </button>
      </div>
    </section>
  )
}
