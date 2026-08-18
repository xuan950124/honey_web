import { useEffect, useState } from 'react'
import { mediaUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'

/**
 * 圖片元件。
 * - 有 src 時顯示真實圖片
 * - 沒有 src、或圖片載入失敗時，顯示留白區塊（不使用任何 emoji 或圖示）
 *
 * 兩個刻意的行為：
 *
 * 1. **檔名提示只有工作人員看得到。** hint 寫的是「product-5.jpg」這種
 *    給自己人對照用的檔名，客人看到只會覺得網站壞了。
 *    客人看到的是乾淨的留白，或一句中性的「照片準備中」。
 *
 * 2. **載入失敗會退回留白，不顯示破圖。** 圖片網址失效（檔案被刪、
 *    外部連結掛掉）時，瀏覽器預設會顯示破掉的圖示加 alt 文字，很難看。
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
  /** 客人在沒有照片時看到的字。留空就是純留白。 */
  emptyText = '',
  className = '',
  style,
  ...rest
}) {
  const { isStaff } = useAuth()
  const [failed, setFailed] = useState(false)

  // 換一張圖時要把失敗狀態清掉，不然改好的圖也顯示不出來
  useEffect(() => setFailed(false), [src])

  const auto = fit === 'auto'
  const showImage = Boolean(src) && !failed

  if (showImage) {
    const cls = auto
      ? `ph-auto${className ? ` ${className}` : ''}`
      : `ph ph--${ratio}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`
    return (
      <div className={cls} style={style} {...rest}>
        <img
          src={mediaUrl(src)}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  // 沒有圖時一律用固定比例的框（auto 模式沒有圖就沒有高度可言）
  const boxRatio = auto ? '16x9' : ratio
  const cls = `ph ph--${boxRatio}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`

  // 工作人員看得到檔名提示與「這張圖掛了」的警告；客人只看到中性文字或留白
  const staffHint = failed
    ? `圖片載入失敗\n${src}`
    : hint
  const text = isStaff ? staffHint : emptyText

  return (
    <div className={cls} style={style} role="img" aria-label={alt || '照片準備中'} {...rest}>
      {text ? (
        <span className={`ph__hint${isStaff && failed ? ' ph__hint--error' : ''}`}>{text}</span>
      ) : null}
    </div>
  )
}
