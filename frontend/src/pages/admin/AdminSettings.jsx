import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import ImageUploader from '../../components/ImageUploader'
import { useSettings } from '../../context/SettingsContext'
import useFocusField from '../../hooks/useFocusField'

const FIELDS = [
  { key: 'shop_name', label: '網站名稱', hint: '顯示在頁首 Logo 與頁尾' },
  {
    key: 'shop_slogan',
    label: '品牌標語（短）',
    hint: '顯示在頁首最上方那條深色橫條。要短，10~16 個字最好看，例：基隆七堵自家蜂場．熟成才採收',
  },
  { key: 'contact_phone', label: '訂購專線', hint: '例：02-1234-5678' },
  { key: 'contact_phone_2', label: '第二組電話', hint: '例：0912-345-678（選填）' },
  { key: 'contact_email', label: 'Email' },
  { key: 'contact_address', label: '地址', hint: '會自動連到 Google 地圖搜尋' },
  { key: 'line_id', label: 'LINE ID', hint: '例：@honeyshop' },
  { key: 'line_url', label: 'LINE 加好友連結', hint: '例：https://line.me/R/ti/p/@honeyshop' },
  { key: 'business_hours', label: '營業時間' },
  { key: 'producer_name', label: '生產者姓名', hint: '會顯示在聯絡頁的溯源資訊旁' },
  {
    key: 'traceability_code',
    label: '農業部溯源追溯編號',
    hint: '例：1801000072。填了之後頁尾與聯絡頁會顯示可點擊的查詢連結，是很有力的信任證明。',
  },
  { key: 'facebook_url', label: 'Facebook 連結' },
  { key: 'instagram_url', label: 'Instagram 連結' },
  {
    key: 'map_embed_url',
    label: 'Google 地圖位置（座標）',
    hint:
      '留空的話系統會用上面的「地址」自動產生地圖，但 Google 對「89-6號」這種細分門牌常常會就近對到「89號」。'
      + '想讓地圖上的點完全精準，請填座標：打開 Google 地圖 → 對著自家門口按滑鼠右鍵 → 點最上面那組數字（會自動複製）→ 貼到這裡，'
      + '格式像 25.105821, 121.712378。也可以貼分享網址或整段 iframe，系統會自動轉換。',
  },
]

// 運費與寄件人（建立物流單時會用到）
//
// 括號裡是綠界 2026 年牌價（未稅），最後結算還要再加 5% 營業稅。
// 把成本寫出來是刻意的 —— 不然很容易設一個看起來合理、實際上每單都在虧的數字。
const SHIPPING_FIELDS = [
  {
    key: 'shipping_fee_cvs',
    label: '7-ELEVEN／全家 超商取貨運費',
    hint: '綠界成本 65 元，含稅約 68 元。',
  },
  {
    key: 'shipping_fee_cvs_hilife',
    label: '萊爾富 超商取貨運費',
    hint: '綠界成本 55 元，含稅約 58 元 —— 比 7-11／全家便宜 10 元，是最省運費的選項。',
  },
  {
    key: 'shipping_fee_home_post',
    label: '中華郵政宅配運費',
    hint: '綠界成本 5 公斤以下 80 元，含稅約 84 元。只有常溫、不到離島，但多罐一起買比黑貓划算很多。',
  },
  {
    key: 'shipping_fee_home',
    label: '黑貓宅急便運費（常溫）',
    hint: '綠界成本 60cm 以下 130 元，含稅約 137 元。',
  },
  {
    key: 'shipping_fee_home_cold',
    label: '黑貓宅急便運費（冷藏／冷凍）',
    hint: '低溫配送的「總運費」，不是加價金額。綠界成本 60cm 以下 160 元、61~90cm 為 225 元。',
  },
  {
    key: 'free_shipping_threshold',
    label: '滿額免運門檻',
    hint: '填 0 表示不提供免運。設一個略高於平均客單的數字，是拉高客單價最有效的方法。',
  },
  { key: 'cod_fee', label: '貨到付款手續費', hint: '會加在買家的訂單金額上，填 0 表示不加收' },
  {
    key: 'unpaid_expire_days',
    label: '未付款訂單保留天數',
    hint: '超過這個天數還沒付款就自動取消並還原庫存。填 0 表示永不自動取消（不建議，庫存會一直被卡住）。綠界的 ATM 與超商代碼繳費期限本來就是 3 天。',
  },
]

// 各頁面的固定圖片，直接在後台上傳，不需要改程式碼
const IMAGE_FIELDS = [
  {
    key: 'hero_image_url',
    label: '首頁主視覺',
    ratio: '4x3',
    hint: '首頁最上方的大圖。建議橫式、約 1200×900，蜂場或蜂箱的實景照最有說服力。',
  },
  {
    key: 'group_buy_image_url',
    label: '團購專區情境照',
    ratio: '4x3',
    hint: '團購頁的配圖，例如整箱包裝好的樣子。',
  },
  {
    key: 'line_qr_url',
    label: 'LINE QR Code',
    ratio: '1x1',
    hint: '正方形。從 LINE 官方帳號後台可以下載自己的 QR Code。',
  },
  {
    key: 'favicon_url',
    label: '網站 icon',
    ratio: '1x1',
    hint: '瀏覽器分頁上的小圖示。正方形、建議 512×512，簡單的圖案才看得清楚（尺寸很小）。留空會用預設的蜂巢圖示。',
  },
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

// 首頁最上面那塊大字。跟「品牌標語」分開，因為兩邊需要的長度差很多。
const HERO_FIELDS = [
  {
    key: 'hero_title',
    label: '首頁大標（第一行）',
    hint: '例：基隆山裡。留空會用預設值。',
  },
  {
    key: 'hero_highlight',
    label: '首頁大標（第二行，會變成金色）',
    hint: '例：等熟成才採的蜜。這是整個網站最先被看到的一句話，寫具體、可以被查證的事最有說服力。',
  },
  {
    key: 'hero_desc',
    label: '首頁大標下的說明',
    hint: '兩到三句話。頁尾的品牌介紹也會用這一段。建議寫「別人做不到或不願意做的事」，而不是形容詞。',
    textarea: true,
  },
]

export default function AdminSettings() {
  const [values, setValues] = useState({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const { reload } = useSettings()

  // 從前台編輯模式帶 ?focus=欄位 過來時，捲到那一格並高亮
  const focused = useFocusField(loaded)

  useEffect(() => {
    api.getSettings()
      .then(setValues)
      .catch((e) => setErr(e.message))
      .finally(() => setLoaded(true))
  }, [])

  const change = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setSaving(true)
    try {
      const payload = {}
      ;[...FIELDS, ...HERO_FIELDS, ...IMAGE_FIELDS, ...SHIPPING_FIELDS, ...SENDER_FIELDS]
        .forEach((f) => { payload[f.key] = values[f.key] || '' })
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

      {focused && (
        <div className="alert alert--info">
          已經幫你捲到你剛剛點的那一格（有金色外框的那個）。
          改完記得按下方的<strong>「儲存全部設定」</strong> —— 這一頁的所有區塊都是一起存的。
        </div>
      )}

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
        <h2 className="panel__title">首頁主視覺文案</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          首頁最上方的大標與說明。改完按最下方的「儲存全部設定」。
        </p>
        {HERO_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            {f.textarea ? (
              <textarea id={f.key} className="input" name={f.key} rows={3}
                        value={values[f.key] || ''} onChange={change} />
            ) : (
              <input id={f.key} className="input" name={f.key}
                     value={values[f.key] || ''} onChange={change} />
            )}
            {f.hint && <div className="field__hint">{f.hint}</div>}
          </div>
        ))}
      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">圖片</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          這些是各頁面的固定圖片。上傳後按最下方的「儲存全部設定」才會生效。
        </p>
        {IMAGE_FIELDS.map((f) => (
          <ImageUploader
            key={f.key}
            name={f.key}
            label={f.label}
            ratio={f.ratio}
            hint={f.hint}
            value={values[f.key] || null}
            onChange={(url) => setValues((v) => ({ ...v, [f.key]: url || '' }))}
          />
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
