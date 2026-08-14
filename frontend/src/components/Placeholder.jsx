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
  className = '',
  style,
}) {
  const cls = `ph ph--${ratio}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`

  if (src) {
    return (
      <div className={cls} style={style}>
        <img src={src} alt={alt} loading="lazy" />
      </div>
    )
  }

  return (
    <div className={cls} style={style} role="img" aria-label={alt || '待補上照片'}>
      {hint ? <span className="ph__hint">{hint}</span> : null}
    </div>
  )
}
