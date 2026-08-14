import { Link } from 'react-router-dom'
import { formatPrice } from '../api/client'
import Placeholder from './Placeholder'

export default function ProductCard({ product, hint }) {
  const soldOut = product.stock <= 0
  const onSale = product.original_price && Number(product.original_price) > Number(product.price)

  return (
    <article className="card">
      <Link to={`/products/${product.id}`} className="card__media">
        {product.is_group_buy && <span className="card__badge">團購</span>}
        {!product.is_group_buy && onSale && <span className="card__badge card__badge--sale">優惠</span>}
        {soldOut && <span className="card__badge card__badge--out">補貨中</span>}
        <Placeholder
          src={product.image_url}
          alt={product.name}
          ratio="1x1"
          hint={hint ?? `商品照片\nproduct-${product.id}.jpg`}
        />
      </Link>
      <div className="card__body">
        {product.category?.name && <div className="card__cat">{product.category.name}</div>}
        <h3 className="card__title">
          <Link to={`/products/${product.id}`}>{product.name}</Link>
        </h3>
        <p className="card__sub">{product.subtitle || ''}</p>
        {(product.spec || product.origin) && (
          <div className="card__meta">
            {product.spec}
            {product.spec && product.origin ? '．' : ''}
            {product.origin}
          </div>
        )}
        <div className="card__foot">
          <div className="price">
            <span className="price__cur">NT$</span>
            {formatPrice(product.price)}
            {onSale && <span className="price__old">NT${formatPrice(product.original_price)}</span>}
          </div>
          <Link to={`/products/${product.id}`} className="btn btn--outline btn--sm">
            看詳情
          </Link>
        </div>
      </div>
    </article>
  )
}
