import { Link } from 'react-router-dom'
import { formatPrice } from '../api/client'
import { editable } from '../context/EditModeContext'
import { prose, tidyBreaks } from '../lib/text'
import Icon from './Icon'
import Placeholder from './Placeholder'

/**
 * 商品格（貨架上的一格）。整格就是一個連結（不再包內層連結，避免巢狀 <a>）。
 * 手機上會收起副標、規格與「看詳情」，讓一排能放兩個、一頁看得到四個商品。
 *
 * variant：
 *   plate — 放在蜂蜜色團購帶上，墊一塊白底
 *   wide  — 團購帶上只有一項時，圖左字右橫著放，不要孤零零一小格
 */
export default function ProductCard({ product, hint, variant }) {
  const soldOut = product.stock <= 0
  const onSale = product.original_price && Number(product.original_price) > Number(product.price)
  // 看得到但還不能買。列表上直接標出來，客人才不會點進去才發現
  const notForSale = product.is_purchasable === false
  const spec = [product.spec, product.origin].filter(Boolean).join('．')

  return (
    <Link
      to={`/products/${product.id}`}
      className={`tile${variant ? ` tile--${variant}` : ''}`}
      {...editable(`商品：${product.name}`, `/admin/products/${product.id}`, null,
        '可以改名稱、價格、庫存、照片、規格與介紹。')}
    >
      <div className="tile__media">
        <div className="tile__badges">
          {/* 「尚未開賣」優先顯示 —— 那比團購標籤更影響客人要不要點進去 */}
          {notForSale && <span className="tile__badge tile__badge--out">尚未開賣</span>}
          {!notForSale && product.is_group_buy && <span className="tile__badge tile__badge--group">團購</span>}
          {!notForSale && !product.is_group_buy && onSale && (
            <span className="tile__badge tile__badge--sale">優惠</span>
          )}
          {!notForSale && soldOut && <span className="tile__badge tile__badge--out">補貨中</span>}
        </div>
        <Placeholder
          src={product.image_url}
          alt={product.name}
          ratio="1x1"
          art="jar"
          hint={hint ?? `商品照片\nproduct-${product.id}.jpg`}
        />
      </div>

      <div className="tile__body">
        <div className="tile__text">
          <h3 className="tile__title">{prose(product.name)}</h3>
          {product.subtitle && <p className="tile__sub">{prose(product.subtitle)}</p>}
          {(product.category?.name || spec) && (
            <p className="tile__meta">
              {product.category?.name && <span className="tile__cat">{product.category.name}</span>}
              {spec && <span className="tile__spec">{product.category?.name ? '．' : ''}{tidyBreaks(spec)}</span>}
            </p>
          )}
        </div>

        <div className="tile__foot">
          <div className="tile__price">
            {onSale && <span className="price__old">NT${formatPrice(product.original_price)}</span>}
            <span className="price">
              <span className="price__cur">NT$</span>{formatPrice(product.price)}
            </span>
          </div>
          <span className="tile__cta">
            {notForSale ? '看看內容' : '看詳情'}
            <Icon name="arrow" size={16} />
          </span>
        </div>
      </div>
    </Link>
  )
}
