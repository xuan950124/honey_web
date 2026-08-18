import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { useSettings } from '../../context/SettingsContext'
import useFocusField from '../../hooks/useFocusField'

/**
 * 政策條款與業者資訊。
 *
 * 跟「網站設定」分開，是因為這一頁的性質不一樣：
 * 網站設定是隨時會調的東西（電話、運費），這一頁則是上線前補一次、
 * 之後很少動的法定揭露事項。混在一起會讓兩邊都變得很難找。
 */

const BUSINESS_FIELDS = [
  {
    key: 'business_name',
    label: '商號／公司名稱',
    hint: '營業登記上的名稱，可能和網站名稱不同。會顯示在頁尾與商品的食品標示。',
  },
  { key: 'business_tax_id', label: '統一編號', hint: '8 碼。個人賣家沒有的話留空。' },
  {
    key: 'food_registration_no',
    label: '食品業者登錄字號',
    hint: '俗稱「非登不可」。到食品藥物業者登錄平台（fadenbook.fda.gov.tw）申請，'
      + '販售包裝食品是法定義務。還沒申請就先留空，但上線前一定要補。',
  },
  { key: 'business_owner', label: '負責人' },
  {
    key: 'business_address',
    label: '廠商地址',
    hint: '食品標示上的廠商地址。留空會用「網站設定」裡的聯絡地址。',
  },
  {
    key: 'business_phone',
    label: '廠商電話',
    hint: '留空會用「網站設定」裡的訂購專線。',
  },
]

const FOOD_FIELDS = [
  {
    key: 'food_default_ingredients',
    label: '內容物名稱（共用預設）',
    hint: '純蜜請明確寫「100% 蜂蜜」—— 2023 年 7 月起只有無添加的產品才能標示為「蜂蜜」，'
      + '寫清楚是保護自己。個別商品可以在商品編輯頁覆寫。',
  },
  {
    key: 'food_default_storage',
    label: '保存方式（共用預設）',
    textarea: true,
  },
  {
    key: 'food_default_allergens',
    label: '過敏原資訊（共用預設）',
    hint: '蜂蜜本身通常不在強制標示的過敏原清單內，但若產線有共用設備處理堅果、'
      + '乳製品等，要主動揭露。沒有就留空。',
  },
  {
    key: 'food_infant_warning',
    label: '食用警語',
    hint: '會顯示在每個商品的購買區塊。一歲以下嬰兒的肉毒桿菌風險是真實的安全問題，'
      + '強烈建議保留這一句。',
    textarea: true,
  },
]

const POLICY_FIELDS = [
  {
    key: 'policy_checkout_notice',
    label: '結帳前的退換貨告知',
    rows: 4,
    hint: '顯示在購物車「送出訂單」按鈕的正上方。'
      + '法規要求「必須在消費者下單前明確告知」才能排除七天猶豫期 —— '
      + '只放在頁尾的連結裡不算數，所以這一段不要刪掉。',
  },
  { key: 'policy_refund', label: '退換貨政策', rows: 22, path: '/refund' },
  { key: 'policy_privacy', label: '隱私權政策', rows: 22, path: '/privacy' },
  { key: 'policy_terms', label: '服務條款', rows: 22, path: '/terms' },
]

export default function AdminPolicies() {
  const [values, setValues] = useState({})
  const [policies, setPolicies] = useState({})
  const [loaded, setLoaded] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const { reload } = useSettings()

  useFocusField(loaded)

  useEffect(() => {
    Promise.all([api.getSettings(), api.policies()])
      .then(([s, p]) => {
        setValues(s)
        setPolicies(p)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoaded(true))
  }, [])

  const change = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))
  const changePolicy = (e) => setPolicies((p) => ({ ...p, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setSaving(true)
    try {
      const payload = {}
      ;[...BUSINESS_FIELDS, ...FOOD_FIELDS].forEach((f) => {
        payload[f.key] = values[f.key] || ''
      })
      POLICY_FIELDS.forEach((f) => { payload[f.key] = policies[f.key] || '' })
      await api.updateSettings(payload)
      reload()
      setMsg('已儲存，前台立即生效')
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  const missing = BUSINESS_FIELDS
    .filter((f) => ['business_name', 'food_registration_no'].includes(f.key))
    .filter((f) => !(values[f.key] || '').trim())
    .map((f) => f.label)

  const field = (f, source, onChange) => (
    <div className="field" key={f.key}>
      <label htmlFor={f.key}>{f.label}</label>
      {f.textarea || f.rows ? (
        <textarea id={f.key} className="input" name={f.key} rows={f.rows || 3}
                  value={source[f.key] || ''} onChange={onChange}
                  style={f.rows > 10 ? { fontFamily: 'var(--sans)', lineHeight: 1.8 } : undefined} />
      ) : (
        <input id={f.key} className="input" name={f.key}
               value={source[f.key] || ''} onChange={onChange} />
      )}
      {f.hint && <div className="field__hint">{f.hint}</div>}
      {f.path && (
        <div className="field__hint">
          前台頁面：<Link to={f.path} target="_blank" style={{ textDecoration: 'underline' }}>
            {f.path}
          </Link>
          　支援 ## 標題、- 清單、| 表格 |、**粗體**、&gt; 引用
        </div>
      )}
    </div>
  )

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">政策條款與業者資訊</h1></div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <div className="alert alert--info">
        <strong>這幾份文字是草稿，不是法律意見。</strong>
        <p className="small" style={{ margin: '6px 0 0' }}>
          內容參考個人資料保護法、消費者保護法與「通訊交易解除權合理例外情事適用準則」撰寫，
          但實際條文請以主管機關公告為準。正式營業前建議請律師或會計師看過一次，
          金額不高但能省掉很多麻煩。
        </p>
      </div>

      {loaded && missing.length > 0 && (
        <div className="alert alert--error">
          <strong>上線前必填：{missing.join('、')}</strong>
          <p className="small" style={{ margin: '6px 0 0' }}>
            販售包裝食品需要食品業者登錄字號（非登不可），
            到「食品藥物業者登錄平台」申請，免費且線上就能辦。
          </p>
        </div>
      )}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">業者資訊</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          會顯示在頁尾與每個商品的食品標示。沒填的欄位前台不會出現空白列。
        </p>
        {BUSINESS_FIELDS.map((f) => field(f, values, change))}
      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">食品標示預設值</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          所有商品共用。個別商品有不同的內容物或保存方式時，
          再到「商品管理 → 編輯」單獨填，那邊填了就以那邊為準。
        </p>
        {FOOD_FIELDS.map((f) => field(f, values, change))}
      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">政策內文</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          清空某一份會回到預設草稿。改壞了就把內容全部刪掉存檔，草稿會回來。
        </p>
        {POLICY_FIELDS.map((f) => field(f, policies, changePolicy))}

        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? '儲存中…' : '儲存全部'}
        </button>
      </form>
    </>
  )
}
