import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatPrice, mediaUrl } from '../api/client'
import Placeholder from '../components/Placeholder'
import { setMetaTag, setStructuredData } from '../components/SiteMeta'
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

  // 商品頁的標題、分享預覽與 Product 結構化資料。
  // 結構化資料會讓 Google 在搜尋結果直接顯示價格與庫存狀態。
  useEffect(() => {
    if (!product) return undefined
    const shop = settings.shop_name || '皇龍蜂蜜'
    const desc = (product.subtitle || product.description || '')
      .replace(/\s+/g, ' ').slice(0, 120) || `${shop}的${product.name}`
    const url = window.location.origin + `/products/${product.id}`
    const image = product.image_url ? mediaUrl(product.image_url) : undefined

    document.title = `${product.name}｜${shop}`
    setMetaTag('name', 'description', desc)
    setMetaTag('property', 'og:title', `${product.name}｜${shop}`)
    setMetaTag('property', 'og:description', desc)
    setMetaTag('property', 'og:type', 'product')
    setMetaTag('property', 'og:url', url)
    if (image) setMetaTag('property', 'og:image', image)

    setStructuredData('product', {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: desc,
      ...(image ? { image: [image] } : null),
      ...(product.origin ? { countryOfOrigin: product.origin } : null),
      brand: { '@type': 'Brand', name: shop },
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'TWD',
        price: String(Number(product.price) || 0),
        availability: product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        seller: { '@type': 'Organization', name: settings.business_name || shop },
      },
    })

    return () => setStructuredData('product', null)
  }, [product, settings])

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

  // 食品標示。商品沒填就用網站設定的共用值 ——
  // 大部分蜂蜜的內容物與保存方式都一樣，不用每個商品重打一次。
  const ingredients = product.ingredients || settings.food_default_ingredients
  const storage = product.storage || settings.food_default_storage
  const allergens = product.allergens || settings.food_default_allergens
  const netWeight = product.net_weight || product.spec
  const infantWarning = settings.food_infant_warning

  // 廠商資訊：法規要求標示，統一由網站設定提供
  const maker = [
    ['廠商名稱', settings.business_name],
    ['廠商地址', settings.business_address || settings.contact_address],
    ['廠商電話', settings.business_phone || settings.contact_phone],
    ['食品業者登錄字號', settings.food_registration_no],
  ].filter(([, v]) => Boolean((v || '').trim()))

  const labelRows = [
    ['內容物名稱', ingredients],
    ['淨重／內容量', netWeight],
    ['原產地（國）', product.origin],
    ['有效日期／保存期限', product.shelf_life],
    ['保存方式', storage],
    ['食品添加物名稱', product.additives],
    ['過敏原資訊', allergens],
    ['營養標示', product.nutrition],
    ...maker,
  ].filter(([, v]) => Boolean((v || '').trim()))

  // 還沒填的欄位有哪些（只給工作人員看，提醒上線前要補齊）
  const missing = [
    ['內容物', ingredients],
    ['淨重', netWeight],
    ['原產地', product.origin],
    ['保存期限', product.shelf_life],
    ['保存方式', storage],
    ['廠商名稱', settings.business_name],
    ['食品業者登錄字號', settings.food_registration_no],
  ].filter(([, v]) => !(v || '').trim()).map(([k]) => k)

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
                {netWeight && <tr><th>淨重／內容量</th><td>{netWeight}</td></tr>}
                {ingredients && <tr><th>內容物</th><td>{ingredients}</td></tr>}
                {product.origin && <tr><th>原產地</th><td>{product.origin}</td></tr>}
                {product.shelf_life && <tr><th>保存期限</th><td>{product.shelf_life}</td></tr>}
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

            {/* 嬰兒警語。這是安全性資訊，要在買之前就看到，不能埋在頁面最下面 */}
            {infantWarning && (
              <div className="warn-box">
                <strong>食用注意</strong>
                <span>{infantWarning}</span>
              </div>
            )}

            {settings.line_id && (
              <p className="small muted" style={{ marginTop: 18 }}>
                大量訂購或需要客製包裝，歡迎加 LINE：{settings.line_id}
                {settings.contact_phone ? `，或來電 ${settings.contact_phone}` : ''}
              </p>
            )}
          </div>
        </div>

        {/*
          食品標示。網路販售包裝食品，這些資訊在「購買前」就要揭露，
          所以放在商品頁而不是只印在瓶身上。
        */}
        <div style={{ marginTop: 64, maxWidth: 760 }}
             {...editable('食品標示', `/admin/products/${product.id}`, null,
               '共用的內容物、保存方式在「政策條款 → 食品標示預設值」，個別商品可以覆寫。')}>
          <h2 className="section-head__title" style={{ fontSize: 22, marginBottom: 6 }}>
            食品標示
          </h2>
          <p className="small muted" style={{ marginBottom: 18 }}>
            依食品安全衛生管理法，網路販售包裝食品應於購買前揭露下列資訊。
          </p>

          {isStaff && missing.length > 0 && (
            <div className="alert alert--error">
              <strong>上線前要補齊：{missing.join('、')}</strong>
              <p className="small" style={{ margin: '6px 0 0' }}>
                商品自己的欄位在「商品管理 → 編輯」；
                共用的內容物、保存方式與廠商資訊在「政策條款」。
                （這段只有工作人員看得到。）
              </p>
            </div>
          )}

          {labelRows.length ? (
            <table className="spec-table">
              <tbody>
                {labelRows.map(([label, value]) => (
                  <tr key={label}>
                    <th>{label}</th>
                    <td style={{ whiteSpace: 'pre-line' }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted small">標示資訊整理中，如需詳細資料歡迎與我們聯繫。</p>
          )}

          {settings.traceability_code && (
            <p className="small" style={{ marginTop: 14 }}>
              生產者可查證：
              <a
                href={`https://qrc.afa.gov.tw/blog/${settings.traceability_code}`}
                target="_blank" rel="noreferrer"
                style={{ color: 'var(--honey-600)', textDecoration: 'underline' }}
              >
                農業部溯源追溯編號 {settings.traceability_code}
              </a>
            </p>
          )}

          <p className="small muted" style={{ marginTop: 14 }}>
            蜂蜜為天然農產品，顏色、風味與結晶狀態會因花期與氣候而不同，屬正常現象。
            退換貨規則請見 <Link to="/refund" style={{ textDecoration: 'underline' }}>退換貨政策</Link>。
          </p>
        </div>

        {product.description && (
          <div style={{ marginTop: 56, maxWidth: 760 }}>
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
