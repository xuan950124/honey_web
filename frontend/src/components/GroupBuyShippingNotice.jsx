import { Link } from 'react-router-dom'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

/**
 * 團購的運送說明。
 *
 * ## 為什麼一定要有這段
 *
 * 網站的購物車**一筆訂單只收一次運費**，綠界也**只會產生一個寄件代碼**。
 * 所以「12 入組」只能寄到一個地址，主購收到後自己分。
 *
 * 但客人很容易以為「備註寫一下就能分寄三個地址」——
 * 真的發生時你只有兩個選擇：自己吸收多出來的兩次運費，或是跟已經付完錢的客人解釋。
 * 兩個都很糟，而且都發生在錢收了之後。
 *
 * 所以這段話要出現在**下單之前**看得到的每一個地方：
 * 團購專區、團購商品的商品頁、購物車。
 *
 * ## 為什麼做成元件而不是寫在每個商品的內文
 *
 * 寫在內文的話，每新增一個團購商品就要記得貼一次同樣的字，
 * 漏貼的那個商品就是下一次客訴。做成元件之後，
 * 只要商品勾了「團購商品」就一定看得到，改文字也只要改一個地方。
 */

export const DEFAULT_GROUP_BUY_NOTICE =
  '網站上的團購組合**只能寄到一個地址**（主購收到後自行分發），'
  + '運費也只收一次。\n'
  + '如果需要**分開包裝、分別寄到不同地址**，請不要直接下單 —— '
  + '請用 LINE 或電話跟我們說，我們會依件數另外報價。'

/** 把 **粗體** 與換行轉成節點。文字只當文字用，不碰 innerHTML。 */
function render(text) {
  return text.split('\n').map((line, li) => (
    <p key={li} style={{ margin: li ? '6px 0 0' : 0 }}>
      {line.split(/\*\*(.+?)\*\*/g).map((part, i) => (
        i % 2 ? <strong key={i}>{part}</strong> : part
      ))}
    </p>
  ))
}

export default function GroupBuyShippingNotice({ compact = false }) {
  const { settings } = useSettings()
  const text = (settings.group_buy_shipping_notice || '').trim() || DEFAULT_GROUP_BUY_NOTICE

  return (
    <div
      className="alert alert--warn"
      style={{ marginTop: compact ? 14 : 0, marginBottom: compact ? 0 : 26 }}
      {...editable('團購運送說明', '/admin/settings', 'group_buy_shipping_notice',
        '這段話會出現在團購專區、團購商品頁與購物車。')}
    >
      <strong>團購組合的運送方式</strong>
      <div className="small" style={{ marginTop: 6, lineHeight: 1.8 }}>
        {render(text)}
      </div>
      {!compact && (
        <div style={{ marginTop: 12 }}>
          <Link to="/contact" className="btn btn--outline btn--sm">分寄需求請先聯絡我們</Link>
        </div>
      )}
    </div>
  )
}
