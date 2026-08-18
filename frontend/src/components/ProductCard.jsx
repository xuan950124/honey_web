import { Link } from 'react-router-dom'
import { formatPrice } from '../api/client'
import { editable } from '../context/EditModeContext'
import Placeholder from './Placeholder'

/**
 * 商品卡。整張卡片就是一個連結（不再包內層連結，避免巢狀 <a>）。
 * 手機上會收起副標、規格與按鈕，讓一排能放兩個、一頁看得到四個商品。
 */
export default function ProductCard({ product, hint }) {
  const soldOut = product.stock <= 0
  const onSale = product.original_price && Number(product.original_price) > Number(product.price)
  // 看得到但還不能買。列表上直接標出來，客人才不會點進去才發現
  const notForSale = product.is_purchasable === false

  return (
    <Link
      to={`/products/${product.id}`}
      className="card"
      {...editable(`商品：${product.name}`, `/admin/products/${product.id}`, null,
        '可以改名稱、價格、庫存、照片、規格與介紹。')}
    >
      <div className="card__media">
        {/* 「尚未開賣」優先顯示 —— 那比團購標籤更影響客人要不要點進去 */}
        {notForSale && <span className="card__badge card__badge--out">尚未開賣</span>}
        {!notForSale && product.is_group_buy && <span className="card__badge">團購</span>}
        {!notForSale && !product.is_group_buy && onSale && (
          <span className="card__badge card__badge--sale">優惠</span>
        )}
        {!notForSale && soldOut && <span className="card__badge card__badge--out">補貨中</span>}
        <Placeholder
          src={product.image_url}
          alt={product.name}
          ratio="1x1"
          hint={hint ?? `商品照片\nproduct-${product.id}.jpg`}
          emptyText="照片準備中"
        />
      </div>

      <div className="card__body">
        {product.category?.name && <div className="card__cat">{product.category.name}</div>}
        <h3 className="card__title">{product.name}</h3>
        {product.subtitle && <p className="card__sub">{product.subtitle}</p>}
        {(product.spec || product.origin) && (
          <div className="card__meta">
            {product.spec}
            {product.spec && product.origin ? '．' : ''}
            {product.origin}
          </div>
        )}

        <div className="card__foot">
          <div className="card__price">
            {onSale && <span className="price__old">NT${formatPrice(product.original_price)}</span>}
            <div className="price">
              <span className="price__cur">NT$</span>{formatPrice(product.price)}
            </div>
          </div>
          <span className="card__cta">{notForSale ? '看看內容' : '看詳情'}</span>
        </div>
      </div>
    </Link>
  )
}
