import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatPrice } from '../api/client'
import Placeholder from '../components/Placeholder'
import { useCart } from '../context/CartContext'
import { useSettings } from '../context/SettingsContext'

export default function ProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [qty, setQty] = useState(1)
  const [mainImage, setMainImage] = useState(null)
  const { add } = useCart()
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

  const soldOut = product.stock <= 0
  const gallery = [product.image_url, ...product.images.map((i) => i.image_url)].filter(Boolean)

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

        <div className="pd">
          <div>
            <Placeholder
              src={mainImage}
              ratio="1x1"
              alt={product.name}
              hint={`商品主圖\nproduct-${product.id}.jpg`}
            />
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
                  <td>{soldOut ? '補貨中' : `尚有 ${product.stock} 組`}</td>
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
                <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={soldOut}>−</button>
                <input
                  type="number" min="1" max={product.stock || 1} value={qty}
                  onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
                  disabled={soldOut}
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(product.stock || 1, q + 1))}
                  disabled={soldOut}
                >
                  ＋
                </button>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                style={{ flex: 1, minWidth: 180 }}
                disabled={soldOut}
                onClick={() => add(product, qty)}
              >
                {soldOut ? '補貨中' : '加入購物車'}
              </button>
            </div>

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
            <p style={{ whiteSpace: 'pre-line', color: 'var(--ink-soft)' }}>{product.description}</p>
            <div style={{ marginTop: 28 }}>
              <Placeholder ratio="16x9" hint={`商品情境照\nproduct-${product.id}-detail.jpg`} alt="商品情境照" />
            </div>
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
          disabled={soldOut}
          onClick={() => add(product, qty)}
        >
          {soldOut ? '補貨中' : `加入購物車（${qty}）`}
        </button>
      </div>
    </section>
  )
}
