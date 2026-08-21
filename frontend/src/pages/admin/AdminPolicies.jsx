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
    label: '商號／蜂場名稱',
    hint: '例：黃家基蜜。會顯示在頁尾與每個商品的食品標示 —— '
      + '食安法要求標示廠商名稱，這一欄一定要填。',
  },
  {
    key: 'business_tax_id',
    label: '統一編號',
    optional: true,
    hint: '沒有就留空，不影響任何功能。自產自銷的農民免辦營業登記、免徵營業稅，'
      + '本來就沒有統編（營業稅法第 8 條第 1 項第 19 款）。'
      + '哪天你開始收購別人的蜜來賣，那部分就要辦稅籍登記，屆時再回來填。',
  },
  {
    key: 'food_registration_no',
    label: '食品業者登錄字號',
    optional: true,
    hint: '俗稱「非登不可」。強制登錄的對象是有商業／公司／工廠登記，'
      + '或有稅籍登記的販售業者 —— 你目前不在強制範圍內，可以留空。'
      + '不過**自願登錄**是可以的，字號印在瓶身與網站上對客人是很直接的信任感，'
      + '到 fadenbook.fda.gov.tw 免費線上辦。',
  },
  { key: 'business_owner', label: '負責人', hint: '例：黃皇龍。會顯示在頁尾。' },
  {
    key: 'business_address',
    label: '廠商地址',
    hint: '食品標示上的廠商地址（食安法第 22 條要求）。留空會用「網站設定」裡的聯絡地址。',
  },
  {
    key: 'business_phone',
    label: '廠商電話',
    hint: '食品標示上的廠商電話。留空會用「網站設定」裡的訂購專線。',
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

  /*
    上線前真正非填不可的，只有食安法第 22 條要求標示的「廠商名稱」。
    統編與食品業者登錄字號都不列在這裡 —— 自產自銷的農民免辦營業登記，
    也不在「非登不可」的強制對象內（強制的是有商業／公司／工廠登記或稅籍登記者）。
    以前把這兩項當必填，等於逼使用者去辦他根本不需要辦的東西。

    地址與電話沒填會自動用「網站設定」裡的聯絡資訊，所以不算缺。
  */
  const REQUIRED = ['business_name']
  const missing = BUSINESS_FIELDS
    .filter((f) => REQUIRED.includes(f.key))
    .filter((f) => !(values[f.key] || '').trim())
    .map((f) => f.label)

  // 提示裡的 **粗體** 轉成 <strong>，讓重點看得出來
  const richHint = (text) => text.split(/\*\*(.+?)\*\*/g)
    .map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part))

  const field = (f, source, onChange) => (
    <div className="field" key={f.key}>
      <label htmlFor={f.key}>
        {f.label}
        {f.optional && <span className="muted small" style={{ marginLeft: 8 }}>選填</span>}
      </label>
      {f.textarea || f.rows ? (
        <textarea id={f.key} className="input" name={f.key} rows={f.rows || 3}
                  value={source[f.key] || ''} onChange={onChange}
                  style={f.rows > 10 ? { fontFamily: 'var(--sans)', lineHeight: 1.8 } : undefined} />
      ) : (
        <input id={f.key} className="input" name={f.key}
               value={source[f.key] || ''} onChange={onChange} />
      )}
      {f.hint && <div className="field__hint">{richHint(f.hint)}</div>}
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
            食安法第 22 條要求包裝食品標示廠商名稱。這一欄沒填，商品頁的食品標示就是不完整的。
          </p>
        </div>
      )}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">業者資訊</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          會顯示在頁尾與每個商品的食品標示。沒填的欄位前台不會出現空白列。
        </p>

        {/*
          這一段是給使用者看的，不是註解式的自我提醒 ——
          很多人（包括之前的我）會以為賣食品一定要統編、一定要非登不可，
          結果卡在那邊不敢上線。把界線一次講清楚。
        */}
        <div className="alert alert--info" style={{ marginBottom: 18 }}>
          <strong>統編與「非登不可」你目前都不需要</strong>
          <p className="small" style={{ margin: '8px 0 0' }}>
            農民銷售自己生產的農產品（含自產農產加工品），依<strong>營業稅法第 8 條第 1 項
            第 19 款</strong>免辦營業登記、免徵營業稅，開<strong>農民收據</strong>即可，
            不需要統編、也不用開統一發票。食品業者登錄（非登不可）強制的對象是
            有商業／公司／工廠登記或稅籍登記的業者，你也不在裡面。
          </p>
          <p className="small" style={{ margin: '8px 0 0' }}>
            <strong>但有一條界線：只限「自產自銷」。</strong>
            哪天你開始<strong>收購別的蜂農的蜜再轉賣</strong>，那部分就跟一般商家一樣，
            要辦稅籍登記、要開發票。首頁寫的「不經過中盤」正好是自產的佐證，
            這個定位要維持住。
          </p>
          <p className="small" style={{ margin: '8px 0 0' }}>
            <strong>這幾件事不會因為你是農民就免除：</strong>包裝食品標示（食安法第 22 條）、
            食品良好衛生規範準則（GHP）、退換貨與隱私權政策（消保法、個資法）。
            這一頁下面的欄位就是在處理這些。
          </p>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            稅務細節可打國稅局免付費專線 0800-000-321，
            標示問題問基隆市衛生局食品科最快。
          </p>
        </div>

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
