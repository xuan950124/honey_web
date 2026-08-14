import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useSettings } from '../../context/SettingsContext'

const FIELDS = [
  { key: 'shop_name', label: '網站名稱', hint: '顯示在頁首 Logo 與頁尾' },
  { key: 'shop_slogan', label: '品牌標語', hint: '顯示在頁首上方橫條與首頁' },
  { key: 'contact_phone', label: '訂購專線', hint: '例：02-1234-5678' },
  { key: 'contact_phone_2', label: '第二組電話', hint: '例：0912-345-678（選填）' },
  { key: 'contact_email', label: 'Email' },
  { key: 'contact_address', label: '地址', hint: '會自動連到 Google 地圖搜尋' },
  { key: 'line_id', label: 'LINE ID', hint: '例：@honeyshop' },
  { key: 'line_url', label: 'LINE 加好友連結', hint: '例：https://line.me/R/ti/p/@honeyshop' },
  { key: 'business_hours', label: '營業時間' },
  { key: 'facebook_url', label: 'Facebook 連結' },
  { key: 'instagram_url', label: 'Instagram 連結' },
  {
    key: 'map_embed_url',
    label: 'Google 地圖網址',
    hint: '留空即可 — 系統會直接用上面的「地址」自動產生地圖。想指定特定位置才需要填，一般分享網址或整段 iframe 都可以貼，會自動轉換。',
  },
]

// 運費與寄件人（建立物流單時會用到）
const SHIPPING_FIELDS = [
  { key: 'shipping_fee_cvs', label: '超商取貨運費', hint: '7-ELEVEN 與全家店到店的運費' },
  { key: 'shipping_fee_home', label: '宅配運費（常溫）' },
  { key: 'shipping_fee_home_cold', label: '宅配運費（冷藏／冷凍）', hint: '低溫配送的總運費，不是加價金額' },
  { key: 'free_shipping_threshold', label: '滿額免運門檻', hint: '填 0 表示不提供免運' },
  { key: 'cod_fee', label: '貨到付款手續費', hint: '會加在買家的訂單金額上，填 0 表示不加收' },
]

const SENDER_FIELDS = [
  {
    key: 'sender_name',
    label: '寄件人姓名',
    hint: '綠界規定：2~5 個中文字，不可含數字或符號。C2C 退件時需憑證件領取，請勿填公司名稱。',
  },
  { key: 'sender_cellphone', label: '寄件人手機', hint: '09 開頭共 10 碼，退貨通知簡訊會寄到這裡' },
  { key: 'sender_phone', label: '寄件人市話', hint: '選填' },
  { key: 'sender_zipcode', label: '寄件人郵遞區號', hint: '宅配必填' },
  { key: 'sender_address', label: '寄件人地址', hint: '宅配必填，需完整且超過 6 個字' },
]

export default function AdminSettings() {
  const [values, setValues] = useState({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const { reload } = useSettings()

  useEffect(() => {
    api.getSettings().then(setValues).catch((e) => setErr(e.message))
  }, [])

  const change = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setSaving(true)
    try {
      const payload = {}
      ;[...FIELDS, ...SHIPPING_FIELDS, ...SENDER_FIELDS].forEach((f) => {
        payload[f.key] = values[f.key] || ''
      })
      await api.updateSettings(payload)
      reload()
      setMsg('設定已儲存，前台已同步更新')
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">網站設定</h1></div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">聯絡資訊與基本設定</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          留空的欄位，前台會顯示「（待補上）」，不會出現空白錯誤。
        </p>

        {FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            <input id={f.key} className="input" name={f.key} value={values[f.key] || ''} onChange={change} />
            {f.hint && <div className="field__hint">{f.hint}</div>}
          </div>
        ))}

      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">運費設定</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          金額請填數字即可，不用加 NT$。修改後前台結帳頁會立即套用。
        </p>
        {SHIPPING_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            <input id={f.key} className="input" type="number" min="0" name={f.key}
                   value={values[f.key] ?? ''} onChange={change} />
            {f.hint && <div className="field__hint">{f.hint}</div>}
          </div>
        ))}
      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">寄件人資訊</h2>
        <div className="alert alert--info">
          這些資料會在「建立物流單」時送給綠界。<strong>宅配一定要填郵遞區號與地址</strong>，
          否則無法建立宅配單。超商店到店則至少需要寄件人姓名。
        </div>
        {SENDER_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            <input id={f.key} className="input" name={f.key}
                   value={values[f.key] ?? ''} onChange={change} />
            {f.hint && <div className="field__hint">{f.hint}</div>}
          </div>
        ))}

        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? '儲存中…' : '儲存全部設定'}
        </button>
      </form>
    </>
  )
}
