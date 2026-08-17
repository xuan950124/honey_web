import { mediaUrl } from '../api/client'

/**
 * 圖片佔位元件。
 * - 有 src 時顯示真實圖片
 * - 沒有 src 時顯示留白區塊（不使用任何 emoji 或圖示），
 *   可選擇顯示淡色的檔名提示，方便之後對照補圖。
 *
 * 之後補圖的兩種方式：
 *   1) 後台上傳照片（推薦）—— 上傳後 image_url 會自動填入。
 *   2) 把圖片放到 frontend/public/images/ 下，再把路徑填成 /images/xxx.jpg。
 */
export default function Placeholder({
  src,
  alt = '',
  ratio = '4x3',
  hint = '',
  plain = false,
  /**
   * fit="cover"（預設）：固定長寬比，超出的部分裁掉。商品卡、縮圖這種
   *   需要整排對齊的地方要用這個。
   * fit="auto"：不裁切，照原始比例顯示，太大才等比縮小。
   *   報導照片、故事照片要用這個 —— 那些圖常常是截圖或直式照片，
   *   硬套 16:9 會把標題和人的頭切掉。
   */
  fit = 'cover',
  className = '',
  style,
  ...rest
}) {
  const auto = fit === 'auto'
  const cls = auto
    ? `ph-auto${className ? ` ${className}` : ''}`
    : `ph ph--${ratio}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`

  if (src) {
    return (
      <div className={cls} style={style} {...rest}>
        <img src={mediaUrl(src)} alt={alt} loading="lazy" />
      </div>
    )
  }

  // 沒有圖時仍需要一個有高度的框，所以固定比例的佔位一律用 ratio
  if (auto) {
    const placeholderCls = `ph ph--16x9${className ? ` ${className}` : ''}`
    return (
      <div className={placeholderCls} style={style} role="img" aria-label={alt || '待補上照片'} {...rest}>
        {hint ? <span className="ph__hint">{hint}</span> : null}
      </div>
    )
  }

  return (
    <div className={cls} style={style} role="img" aria-label={alt || '待補上照片'} {...rest}>
      {hint ? <span className="ph__hint">{hint}</span> : null}
    </div>
  )
}
