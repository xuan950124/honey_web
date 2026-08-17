import { COUPON_KIND_TEXT, formatDate, formatPrice } from '../api/client'

/** 折價券卡片。可當作純顯示，也可當作可選取的按鈕（傳 onSelect）。 */
export default function CouponCard({ coupon, selected, onSelect, disabled }) {
  const used = Boolean(coupon.used_at)

  const value =
    coupon.kind === 'free_shipping'
      ? '免運'
      : coupon.kind === 'percent'
        ? `${Number(coupon.value)}%`
        : formatPrice(coupon.value)

  const unit =
    coupon.kind === 'free_shipping' ? '' : coupon.kind === 'percent' ? 'OFF' : '元'

  const Wrapper = onSelect ? 'button' : 'div'

  return (
    <Wrapper
      {...(onSelect ? { type: 'button', onClick: () => onSelect(coupon), disabled } : {})}
      className={`coupon${selected ? ' is-selected' : ''}${used ? ' coupon--used' : ''}`}
    >
      <div className="coupon__stub">
        <div className="coupon__value">{value}</div>
        {unit && <div className="coupon__unit">{unit}</div>}
      </div>
      <div className="coupon__body">
        <div className="coupon__name">{coupon.name}</div>
        <div className="coupon__meta">{coupon.label || COUPON_KIND_TEXT[coupon.kind]}</div>
        <div className="coupon__meta" style={{ marginTop: 4 }}>
          <span className="coupon__code">{coupon.code}</span>
          {coupon.expires_at && !used && `．${formatDate(coupon.expires_at)} 到期`}
          {used && `．已於 ${formatDate(coupon.used_at)} 使用`}
        </div>
      </div>
    </Wrapper>
  )
}
