import { useEffect, useState } from 'react'
import { mediaUrl } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Art from './Art'

/**
 * 圖片元件。
 * - 有 src 時顯示真實圖片
 * - 沒有 src、或圖片載入失敗時：給了 art 就放一張標籤上的插畫（同一套配色），
 *   沒給就是一塊跟網站同色系的色塊（不使用任何 emoji 或圖示）
 *
 * 兩個刻意的行為：
 *
 * 1. **檔名提示只有工作人員看得到。** hint 寫的是「product-5.jpg」這種
 *    給自己人對照用的檔名，客人看到只會覺得網站壞了。
 *    客人看到的是插畫、色塊，或一句中性的「照片準備中」。
 *
 * 2. **載入失敗會退回插畫或色塊，不顯示破圖。** 圖片網址失效（檔案被刪、
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
  /** 客人在沒有照片時看到的字。留空就是純色塊（或插畫）。 */
  emptyText = '',
  /** 沒有照片時畫哪一張插畫：apiary（蜂場）、jar（蜂蜜罐）、comb（巢框）。 */
  art = '',
  /** 首屏的大圖不要延遲載入，其他一律 lazy。 */
  eager = false,
  /** 第一張載入失敗時改用的備用照片。兩張都沒有才放插畫。 */
  fallbackSrc = '',
  fallbackAlt = '',
  className = '',
  style,
  ...rest
}) {
  const { isStaff } = useAuth()
  // 失敗了幾張：0 = 用 src；1 = 改用 fallbackSrc；再失敗就畫插畫
  const [failures, setFailures] = useState(0)

  // 換一張圖時要把失敗狀態清掉，不然改好的圖也顯示不出來
  useEffect(() => { setFailures(0) }, [src, fallbackSrc])

  const sources = [src, fallbackSrc].filter(Boolean)
  const current = sources[failures] || ''
  const usingFallback = Boolean(current) && current !== src
  const failed = failures > 0 && !current

  const handleError = () => setFailures((n) => n + 1)

  const auto = fit === 'auto'
  const showImage = Boolean(current)

  if (showImage) {
    const cls = auto
      ? `ph-auto${className ? ` ${className}` : ''}`
      : `ph ph--${ratio}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`
    return (
      <div className={cls} style={style} {...rest}>
        <img
          key={current}
          src={mediaUrl(current)}
          alt={usingFallback ? (fallbackAlt || alt) : alt}
          loading={eager ? 'eager' : 'lazy'}
          {...(eager ? { fetchpriority: 'high' } : null)}
          onError={handleError}
        />
      </div>
    )
  }

  // 沒有圖時一律用固定比例的框（auto 模式沒有圖就沒有高度可言）
  const boxRatio = auto ? '16x9' : ratio
  const cls = `ph ph--${boxRatio}${art ? ' ph--art' : ''}${plain ? ' ph--plain' : ''}${className ? ` ${className}` : ''}`

  // 工作人員看得到檔名提示與「這張圖掛了」的警告；客人只看到插畫、中性文字或色塊
  const staffHint = failed && src && !art
    ? `圖片載入失敗\n${src}`
    : hint
  const text = isStaff ? staffHint : emptyText

  return (
    <div className={cls} style={style} role="img" aria-label={alt || '照片準備中'} {...rest}>
      {art && <Art name={art} />}
      {text ? (
        <span className={`ph__hint${isStaff && failed && !art ? ' ph__hint--error' : ''}`}>{text}</span>
      ) : null}
    </div>
  )
}
