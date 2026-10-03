import { useId } from 'react'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'
import Icon from './Icon'

/**
 * 溯源標示：印著真實的農業部追溯編號，點了直接開政府的查詢頁。
 *
 * 這是整個網站最重要的證據 ——「請相信我們」換成「你可以自己查」。
 *
 * variant：
 *   seal   — 首頁插畫上那張圓形貼紙。跟店家自己的圓形 Logo 貼紙同一種形狀（模切的圓），
 *            外圈一圈字、中間是編號；斜斜地貼在插畫左下角。
 *   inline — 商品頁價格旁的小標籤，照標籤上營養標示的樣子：墨色細框、上一行小標、下一行編號。
 *   footer — 墨色頁尾上的反白版。
 *
 * 注意用詞：這是「溯源」，不是「產銷履歷」（見 PRODUCT.md）。
 * 外圈的兩句話都是網站原本就有的文案，不是新寫的宣傳詞。
 *
 * 後台沒填編號時整個不顯示（不對客人露出空的標示）。
 */
const RING = '農業部溯源追溯編號・每一瓶都查得到生產者是誰・'

export default function TraceStamp({ variant = 'seal', className = '' }) {
  const { settings } = useSettings()
  const ringId = `trace-ring-${useId().replace(/:/g, '')}`
  const code = settings.traceability_code
  if (!code) return null

  const common = {
    ...editable('溯源追溯編號', '/admin/settings', 'traceability_code'),
    href: `https://qrc.afa.gov.tw/blog/${code}`,
    target: '_blank',
    rel: 'noreferrer',
    'aria-label': `農業部溯源追溯編號 ${code}（開啟農業部查詢頁）`,
  }

  if (variant === 'seal') {
    return (
      <a {...common} className={`trace-seal${className ? ` ${className}` : ''}`}>
        <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <defs>
            {/* 從九點鐘方向開始、順時針繞一圈的圓，外圈的字沿著它排 */}
            <path id={ringId} d="M 100 100 m -77 0 a 77 77 0 1 1 154 0 a 77 77 0 1 1 -154 0" />
          </defs>
          <circle className="trace-seal__disk" cx="100" cy="100" r="99" />
          <text className="trace-seal__ring">
            <textPath href={`#${ringId}`} textLength="476" lengthAdjust="spacing">{RING}</textPath>
          </text>
          <circle className="trace-seal__rule" cx="100" cy="100" r="61" />
          <text className="trace-seal__code" x="100" y="106" textAnchor="middle"
                textLength="112" lengthAdjust="spacingAndGlyphs">{code}</text>
          {/* 外連箭頭（跟網站其他外部連結同一個圖示） */}
          <path className="trace-seal__go" d="M93 133 104 122m-8 0h8v8" />
        </svg>
      </a>
    )
  }

  return (
    <a {...common} className={`trace-tag trace-tag--${variant}${className ? ` ${className}` : ''}`}>
      <span className="trace-tag__head">農業部溯源追溯編號</span>
      <span className="trace-tag__row">
        <span className="trace-tag__code">{code}</span>
        <Icon name="external" size={16} />
      </span>
    </a>
  )
}
