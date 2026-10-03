import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, formatPrice, mediaUrl } from '../api/client'
import Gallery from '../components/Gallery'
import GroupBuyShippingNotice from '../components/GroupBuyShippingNotice'
import Icon from '../components/Icon'
import Placeholder from '../components/Placeholder'
import TraceStamp from '../components/TraceStamp'
import { setMetaTag, setStructuredData } from '../components/SiteMeta'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'
import { prose, stripEditorNotes } from '../lib/text'

export default function ProductDetail() {
  const { id } = useParams()
  const [product, setProduct] = useState(null)
  const [error, setError] = useState('')
  const [qty, setQty] = useState(1)
  // 手機底部的購買列：等頁面上那一排（數量＋加入購物車）捲過去了才出現。
  // 一進來就出現的話，客人還沒看到上面的嬰兒警語就能直接按下去。
  const buyRow = useRef(null)
  const [pastBuyRow, setPastBuyRow] = useState(false)
  const { add, items } = useCart()
  const { isStaff } = useAuth()
  const { settings } = useSettings()

  useEffect(() => {
    window.scrollTo(0, 0)
    api
      .getProduct(id)
      .then((p) => {
        setProduct(p)
        setQty(1)
      })
      .catch((e) => setError(e.message))
  }, [id])

  // 商品頁的標題、分享預覽與 Product 結構化資料。
  // 結構化資料會讓 Google 在搜尋結果直接顯示價格與庫存狀態。
  useEffect(() => {
    if (!product) return undefined
    const shop = settings.shop_name || '黃家基蜜'
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

  useEffect(() => {
    if (!product) return undefined
    // 用捲動事件而不是 IntersectionObserver：一次跳很遠（點錨點、快速甩動）時，
    // 那一排可能從「在畫面下方」直接變成「在畫面上方」，觀察器不會通知
    let frame = 0
    const check = () => {
      frame = 0
      const el = buyRow.current
      if (el) setPastBuyRow(el.getBoundingClientRect().bottom < 0)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(check) }
    check()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [product])

  if (error) {
    return (
      <div className="container section">
        <div className="empty-state">
          <div className="empty-state__title">{error}</div>
          <Link to="/products" className="btn btn--outline">回到商品列表</Link>
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
  // 「看得到但還不能買」。工作人員例外 —— 這個開關就是為了讓你先測完整流程
  const notForSale = product.is_purchasable === false && !isStaff
  const notForSaleNote = (product.unavailable_note || '').trim() || '這項商品還在準備中，尚未開放購買'
  const cannotBuy = notForSale || soldOut || cartFull
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

  /*
    商品頁做成一張攤開的標籤：左邊照片放在花系的正面色上、右邊購買區是資訊面。
    現在上架的都是紅淡蜜（紅淡比花系：珊瑚紅＋蜂蜜黃）；
    之後鴨腳木花系上架，品名裡有「鴨腳木」的商品會自動換成鴨腳木標籤的顏色（天空藍＋檸檬黃綠）。
  */
  const series = /鴨腳木/.test(product.name || '') ? 'schefflera' : 'cleyera'

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

        <div className={`pd pd--${series}`} {...editable(`商品：${product.name}`, `/admin/products/${product.id}`)}>
          <div className="pd__gallery">
            <Gallery images={gallery} alt={product.name} hint={`商品主圖\nproduct-${product.id}.jpg`} />
            {/* 工作人員才看得到：只有一張照片時提醒可以再加 */}
            {isStaff && gallery.length < 2 && (
              <p className="staff-note">這項商品只有 {gallery.length} 張照片。到商品管理多傳幾張，客人就能左右滑著看。（這行只有工作人員看得到）</p>
            )}
          </div>

          <div className="pd__info">
            <h1 className="pd__title">{prose(product.name)}</h1>
            {product.subtitle && <p className="pd__sub">{prose(product.subtitle)}</p>}

            <div className="pd__price">
              <span className="pd__price-now"><span className="price__cur">NT$</span>{formatPrice(product.price)}</span>
              {product.original_price && Number(product.original_price) > Number(product.price) && (
                <span className="price__old">NT${formatPrice(product.original_price)}</span>
              )}
              {product.is_group_buy && <span className="sticker pd__chip">團購商品</span>}
              <TraceStamp variant="inline" className="pd__trace" />
            </div>

            {product.group_buy_note && (
              <div className="alert alert--info pd__note">
                {product.group_buy_note}
              </div>
            )}

            {/*
              團購商品一定要看到運送說明。
              購物車一筆訂單只收一次運費、只產生一個寄件代碼，
              客人若以為備註一下就能分寄三個地址，發現時錢已經收了。
              自動跟著「團購商品」這個勾選跑，不必每個商品的內文各貼一次。
            */}
            {product.is_group_buy && <GroupBuyShippingNotice compact />}

            {/* 還沒開放購買時，把原因講在按鈕上面，不要只給一顆按不動的灰按鈕 */}
            {notForSale && (
              <div className="alert alert--info pd__note">
                <strong>{notForSaleNote}</strong>
                {settings.line_id && (
                  <p className="alert__more">
                    想先預訂或想知道開賣時間，歡迎加 LINE {settings.line_id} 問我們。
                  </p>
                )}
              </div>
            )}

            {product.is_purchasable === false && isStaff && (
              <div className="alert alert--error pd__note">
                <strong>這項商品目前設定為「不開放購買」</strong>
                <p className="alert__more">
                  客人看得到但買不了。你是工作人員所以仍可下單測試。
                  要開賣請到商品編輯頁把「開放購買」打勾。（這段只有工作人員看得到。）
                </p>
              </div>
            )}

            {/* 嬰兒警語。這是安全性資訊，要在按「加入購物車」之前就看到，所以放在按鈕上面 */}
            {infantWarning && (
              <div className="warn-box">
                <strong>食用注意</strong>
                <span>{infantWarning}</span>
              </div>
            )}

            <div className="pd__buy" ref={buyRow}>
              <div className="qty">
                <button type="button" disabled={cannotBuy || qty <= 1}
                        onClick={() => setQty((q) => clampQty(q - 1))} aria-label="減少數量">−</button>
                <input
                  type="number" min="1" max={maxQty} value={qty}
                  onChange={(e) => setQty(clampQty(e.target.value))}
                  disabled={cannotBuy}
                  aria-label="數量"
                />
                <button type="button" disabled={cannotBuy || qty >= room}
                        onClick={() => setQty((q) => clampQty(q + 1))} aria-label="增加數量">＋</button>
              </div>
              <button
                type="button"
                className="btn btn--primary btn--lg pd__add"
                disabled={cannotBuy}
                onClick={() => { add(product, qty); setQty(1) }}
              >
                {notForSale ? '尚未開放購買'
                  : soldOut ? '補貨中'
                    : cartFull ? '購物車已達庫存上限'
                      : '加入購物車'}
              </button>
            </div>

            {cartFull && (
              <p className="pd__warn">
                庫存共 {stock} 組，已全部在你的購物車裡了。
                <Link to="/cart">　前往結帳</Link>
              </p>
            )}
          </div>

          {/*
            規格、商品介紹與食品標示：排在標籤（照片＋購買區）底下。
            捲過購買區之後，底部會出現固定的購買列（電腦與手機都有），讀到哪都能直接買。

            食品標示：網路販售包裝食品，這些資訊在「購買前」就要揭露，
            所以放在商品頁而不是只印在瓶身上。
          */}
          <div className="pd__more">
            {/*
              規格表、大量訂購的說明與商品介紹放在左欄，食品標示在右欄；
              購買區只留標題到「加入購物車」，筆電螢幕一眼看得完。
              規格表放最前面、商品介紹放在規格表和食品標示中間 ——
              兩張表有幾列一樣（淨重、內容物、原產地、保存期限），不要讓它們上下連在一起。
            */}
            <div className="pd__about">
              <div className="pd__spec">
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
                          <span className="spec-table__aside">（購物車裡已有 {inCart} 組）</span>
                        )}
                      </td>
                    </tr>
                    {product.category?.name && <tr><th>分類</th><td>{product.category.name}</td></tr>}
                    {product.is_group_buy && product.group_buy_min_qty && (
                      <tr><th>成團數量</th><td>{product.group_buy_min_qty} 組起</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {settings.line_id && (
                <p className="pd__contact">
                  大量訂購或需要客製包裝，歡迎加 LINE：{settings.line_id}
                  {settings.contact_phone ? `，或來電 ${settings.contact_phone}` : ''}
                </p>
              )}

              {product.description && (
                <div className="pd__desc">
                  <h2 className="block-title">商品介紹</h2>
                  <p className="pd__desc-text">
                    {prose(stripEditorNotes(product.description))}
                  </p>
                  {/* 情境照沒上傳時整塊不顯示，不要留一個空框給客人看 */}
                  {(product.images?.[1]?.image_url || isStaff) && (
                    <div className="pd__scene">
                      <Placeholder
                        src={product.images?.[1]?.image_url}
                        fit="auto"
                        art="jar"
                        hint={`商品情境照\nproduct-${product.id}-detail.jpg`}
                        alt="商品情境照"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="food-label"
                 {...editable('食品標示', `/admin/products/${product.id}`, null,
                   '共用的內容物、保存方式在「政策條款 → 食品標示預設值」，個別商品可以覆寫。')}>
              <div className="food-label__head">
                <h2 className="food-label__title">食品標示</h2>
                <p className="food-label__law">
                  依食品安全衛生管理法，網路販售包裝食品應於購買前揭露下列資訊。
                </p>
              </div>

              {isStaff && missing.length > 0 && (
                <div className="alert alert--error">
                  <strong>上線前要補齊：{missing.join('、')}</strong>
                  <p className="alert__more">
                    商品自己的欄位在「商品管理 → 編輯」；
                    共用的內容物、保存方式與廠商資訊在「政策條款」。
                    （這段只有工作人員看得到。）
                  </p>
                </div>
              )}

              {labelRows.length ? (
                // --wide：這張表的欄位名長很多（「有效日期／保存期限」），
                // 用規格表那個 100px 的標籤欄會折行，看起來像壞掉
                <table className="spec-table spec-table--wide">
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
                <p className="food-label__empty">標示資訊整理中，如需詳細資料歡迎與我們聯繫。</p>
              )}

              {settings.traceability_code && (
                <p className="food-label__trace">
                  生產者可查證：
                  <a
                    href={`https://qrc.afa.gov.tw/blog/${settings.traceability_code}`}
                    target="_blank" rel="noreferrer"
                  >
                    農業部溯源追溯編號 {settings.traceability_code}
                    <Icon name="external" size={16} />
                  </a>
                </p>
              )}

              <p className="food-label__foot">
                {'蜂蜜為天然農產品，顏色、風味與結晶狀態會因花期與氣候而不同，屬正常現象。'}
                {'退換貨規則請見 '}<Link to="/refund">退換貨政策</Link>。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 捲過購買區之後固定在底部的購買列（電腦與手機都有），捲到哪都能直接買 */}
      <div className={`buy-bar${pastBuyRow ? ' is-visible' : ''}`} aria-hidden={!pastBuyRow}>
        <div className="buy-bar__price">
          <div className="buy-bar__label">{product.spec || '售價'}</div>
          <div className="price">
            <span className="price__cur">NT$</span>{formatPrice(product.price)}
          </div>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={cannotBuy}
          onClick={() => { add(product, qty); setQty(1) }}
        >
          {notForSale ? '尚未開放購買'
            : soldOut ? '補貨中'
              : cartFull ? '已達庫存上限'
                : `加入購物車（${qty}）`}
        </button>
      </div>
    </section>
  )
}
