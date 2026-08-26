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
    key: 'map_link_url',
    label: '地圖連結（分享短網址）',
    textarea: true,
    rows: 2,
    hint:
      '**最重要的一欄。** 地址文字與地圖角落的「規劃路線」都會開這個連結。'
      + '　拿法：Google 地圖搜尋自己的商家 → 按「分享」→「傳送連結」→ 複製，'
      + '像 https://maps.app.goo.gl/xxxxxxxx。'
      + '　為什麼要填：留空的話系統只能把地址丟給 Google 讓它自己找，'
      + '而 Google 對「89-6號」這種細分門牌會就近對到「89號」，'
      + '客人按規劃路線就被導到隔壁、白跑一趟。分享連結直接指向你的商家檔案，沒有猜的空間。',
  },
  {
    key: 'map_embed_url',
    label: '地圖嵌入碼',
    textarea: true,
    rows: 4,
    hint:
      '頁面上那張地圖。Google 地圖 → 「分享」→「**嵌入地圖**」→「複製 HTML」，'
      + '整段 `<iframe …>` 直接貼進來就好，不用自己挑出網址。'
      + '　這樣地圖上會顯示你的店名與評分那張小卡；'
      + '留空或只填地址的話只會有一根光禿禿的針。'
      + '　也可以貼座標（像 25.105821, 121.712378），系統一樣認得。',
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

/*
  付款方式。

  這裡只能**再關掉**，不能打開綠界還沒開通的服務 ——
  放一個「開啟信用卡」的開關會讓人以為自己開得起來，
  但錢收不收得到是綠界那邊決定的，開了只會讓客人刷了卻沒入帳。
*/
const PAYMENT_METHODS = [
  { value: 'credit', label: '信用卡', note: '費率 2.75%，入帳最快' },
  { value: 'atm', label: 'ATM 虛擬帳號', note: '每筆手續費較低，但買家可能忘記轉帳' },
  { value: 'cvs_code', label: '超商代碼繳費', note: '沒有網銀的買家會用；有金額上限' },
  { value: 'cod', label: '貨到付款', note: '取貨時付現，走物流代收貨款' },
]

// 團購的運送說明。獨立一個欄位而不是叫店家去每個商品的內文各貼一次 ——
// 漏貼的那個商品就是下一次客訴。
const GROUP_BUY_FIELDS = [
  {
    key: 'group_buy_shipping_notice',
    label: '團購運送說明',
    textarea: true,
    rows: 5,
    hint: '會顯示在團購專區、每個團購商品的商品頁，以及購物車的備註欄旁邊。'
      + '重點是講清楚「網站下單只寄一個地址」——'
      + '購物車一筆訂單只收一次運費，物流也只會產生一個寄件代碼，'
      + '客人若在備註要求分寄三個地址，多出來的運費要你自己吸收。'
      + '留空會用預設文字。支援 **粗體** 與換行。',
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
  {
    key: 'sender_zipcode',
    label: '寄件人郵遞區號',
    hint: '留空也可以，系統會從下面的地址自己查',
  },
  {
    key: 'sender_address',
    label: '寄件人地址',
    hint: '宅配必填。請含縣市與區，郵遞區號會自動查',
  },
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

/**
 * 說明文字裡的 **粗體** 與 `程式碼` 轉成節點，讓重點看得出來。
 *
 * 用 exec 逐段掃而不是 split()：split 的擷取群組會把兩種標記的結果混在一起，
 * 分不出某一段原本是粗體還是程式碼。
 */
function richHint(text) {
  const out = []
  const re = /\*\*(.+?)\*\*|`(.+?)`/g
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1]
      ? <strong key={m.index}>{m[1]}</strong>
      : <code key={m.index} className="hint-code">{m[2]}</code>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function AdminSettings() {
  const [values, setValues] = useState({})
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [checkout, setCheckout] = useState(null)
  /*
    LINE 的設定狀態。

    這一區存在的理由是踩過的坑：`/api/line/status` 只有工作人員能看，
    而在瀏覽器直接打開那個網址是**普通導航、不會帶 Authorization 標頭**
    （權杖存在 localStorage，只有 fetch 會加），所以一定看到
    「登入憑證無效或已過期」。要看狀態就得在**後台頁面裡**看。
  */
  const [lineInfo, setLineInfo] = useState(null)
  const [lineTest, setLineTest] = useState('')
  const [recipients, setRecipients] = useState(null)
  const [pairCode, setPairCode] = useState(null)

  const reloadLine = () => {
    api.lineStatus().then(setLineInfo).catch(() => {})
    api.lineRecipients().then(setRecipients).catch(() => {})
  }
  const { reload } = useSettings()

  // 從前台編輯模式帶 ?focus=欄位 過來時，捲到那一格並高亮
  const focused = useFocusField(loaded)

  useEffect(() => {
    api.getSettings()
      .then(setValues)
      .catch((e) => setErr(e.message))
      .finally(() => setLoaded(true))
    // 綠界目前開通到哪，決定哪些付款方式「勾了也沒用」
    api.checkoutOptions().then(setCheckout).catch(() => {})
    reloadLine()
  }, [])

  const change = (e) => setValues((v) => ({ ...v, [e.target.name]: e.target.value }))

  /*
    付款方式：空字串 = 全開。

    存成逗號分隔的字串而不是每個方式一個設定鍵，
    是因為「有沒有勾」跟「這個鍵存不存在」很容易混淆 ——
    一個字串就沒有這個問題，而且加新的付款方式時不必動資料。
  */
  const ecStatus = checkout?.ecpay_status || {}
  const canOnline = Boolean(ecStatus.can_sell_online)
  const enabledSet = new Set(
    (values.payment_methods_enabled || '').split(',').map((s) => s.trim()).filter(Boolean),
  )
  const isOn = (v) => enabledSet.size === 0 || enabledSet.has(v)

  const togglePayment = (v) => {
    // 從「全開」狀態按第一下時，先展開成完整清單再拿掉那一個，
    // 不然會變成「只留這一個」，跟使用者想的相反
    const base = enabledSet.size === 0 ? PAYMENT_METHODS.map((p) => p.value) : [...enabledSet]
    let next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v]
    if (!next.length) next = ['cod']   // 不留任何一種等於關店
    const all = next.length === PAYMENT_METHODS.length
    setValues((s) => ({
      ...s,
      // 全部都勾就存回空字串，語意上等於「跟著綠界開通的走」
      payment_methods_enabled: all ? '' : next.join(','),
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setSaving(true)
    try {
      const payload = {}
      ;[...FIELDS, ...HERO_FIELDS, ...IMAGE_FIELDS, ...GROUP_BUY_FIELDS,
        ...SHIPPING_FIELDS, ...SENDER_FIELDS]
        .forEach((f) => { payload[f.key] = values[f.key] || '' })
      payload.payment_methods_enabled = values.payment_methods_enabled || ''
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
            {/* 地圖那兩欄貼進來的是一整段 iframe 或長網址，單行輸入框看不到自己貼了什麼 */}
            {f.textarea ? (
              <textarea id={f.key} className="textarea" rows={f.rows || 3} name={f.key}
                        value={values[f.key] || ''} onChange={change}
                        style={{ fontFamily: 'var(--mono, monospace)', fontSize: 12.5 }} />
            ) : (
              <input id={f.key} className="input" name={f.key}
                     value={values[f.key] || ''} onChange={change} />
            )}
            {f.hint && <div className="field__hint">{richHint(f.hint)}</div>}
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

      {/*
        LINE 機器人的設定狀態。只顯示「有沒有填」，不回傳任何金鑰內容 ——
        後台被看一眼就不該把設定全部洩漏出去。
      */}
      <div className="panel">
        <h2 className="panel__title">LINE 通知機器人</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          有訂單就推播到你的 LINE，訊息上直接有「建立物流單」按鈕，
          按下去回傳寄件代碼。設定在後端環境變數（Zeabur → 後端服務 → Variables）。
        </p>

        {!lineInfo && <div className="loading">讀取設定中…</div>}

        {lineInfo && (
          <>
            <div className={`alert alert--${lineInfo.ready ? 'success' : 'warn'}`}>
              <strong>
                {lineInfo.ready ? 'LINE 通知已啟用' : '還沒設定完成，目前不會推播'}
              </strong>
              <table className="spec-table spec-table--wide" style={{ margin: '10px 0 0' }}>
                <tbody>
                  <tr>
                    <th>LINE_CHANNEL_ACCESS_TOKEN</th>
                    <td>{lineInfo.configured ? '已設定' : '未設定（推不出訊息）'}</td>
                  </tr>
                  <tr>
                    <th>LINE_CHANNEL_SECRET</th>
                    <td>
                      {lineInfo.can_verify
                        ? '已設定'
                        : '未設定（驗不了簽章，按鈕功能會整個關閉）'}
                    </td>
                  </tr>
                  <tr>
                    <th>LINE_ADMIN_USER_IDS</th>
                    <td>
                      {lineInfo.admin_count
                        ? `${lineInfo.admin_count} 個帳號`
                        : '未設定（沒有人會收到通知，也沒有人按得動按鈕）'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="field">
              <label htmlFor="line-webhook">Webhook URL（貼到 LINE Developers）</label>
              <input id="line-webhook" className="input" readOnly value={lineInfo.webhook_url}
                     onFocus={(e) => e.target.select()} />
              <div className="field__hint">
                {richHint(
                  'LINE Developers → 你的 channel → **Messaging API** 分頁 → '
                  + 'Webhook URL 填這個，打開 **Use webhook**，然後按 Verify。'
                  + '順便把 Auto-reply messages 關掉，不然機器人回一次、罐頭訊息再回一次。',
                )}
              </div>
            </div>

            {/*
              收件人名單。**可以有多個人** —— 家人、幫忙出貨的人都能各自收到通知。

              加人不用複製那串 33 個字元的 user ID：後台產生六位配對碼，
              對方在 LINE 打那六個字就好。用手機複製 ID 再貼到電腦，
              少一個字就整個不會動，而且錯了完全沒有提示。
            */}
            <div className="field">
              <label>誰會收到通知</label>
              {recipients && (
                <>
                  {!recipients.from_settings.length && !recipients.from_env.length && (
                    <div className="field__hint">
                      目前<strong>沒有任何人</strong>。沒有人收得到通知，
                      也沒有人按得動「建立物流單」。
                    </div>
                  )}
                  {recipients.from_settings.map((id) => (
                    <div key={id} className="check-row">
                      <span style={{ flex: 1 }}>
                        <code className="hint-code">{id}</code>
                      </span>
                      <button type="button" className="btn btn--ghost btn--sm"
                              onClick={async () => {
                                if (!window.confirm(`把 ${id} 從通知名單移除？`)) return
                                try {
                                  await api.lineRemoveRecipient(id)
                                  reloadLine()
                                } catch (e) { setErr(e.message) }
                              }}>
                        移除
                      </button>
                    </div>
                  ))}
                  {recipients.from_env.map((id) => (
                    <div key={id} className="check-row">
                      <span style={{ flex: 1 }}>
                        <code className="hint-code">{id}</code>
                        <span className="small muted" style={{ marginLeft: 8 }}>
                          來自環境變數，要移除請到 Zeabur 改
                        </span>
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className="field">
              <label>加一個人（不用複製 ID）</label>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn--primary btn--sm"
                        onClick={async () => {
                          try {
                            setPairCode(await api.linePairCode())
                          } catch (e) { setErr(e.message) }
                        }}>
                  產生配對碼
                </button>
                {pairCode && (
                  <span>
                    <strong style={{ fontSize: 26, letterSpacing: 4 }}>{pairCode.code}</strong>
                    <span className="small muted" style={{ marginLeft: 10 }}>
                      {pairCode.minutes} 分鐘內有效
                    </span>
                  </span>
                )}
              </div>
              <div className="field__hint">
                {richHint(
                  '請那個人**先加官方帳號好友**，然後在聊天室把這六位數字傳過去，'
                  + '就會自動加入通知名單。一組碼只能用一次。'
                  + '　加完記得按下面的「重新整理」看名單。',
                )}
              </div>
              <button type="button" className="btn btn--ghost btn--sm"
                      onClick={() => { setPairCode(null); reloadLine() }}>
                重新整理名單
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn--outline btn--sm"
                      onClick={async () => {
                        setLineTest('傳送中…')
                        try {
                          const res = await api.lineTest()
                          setLineTest(res.message)
                        } catch (e) {
                          setLineTest(e.message)
                        }
                      }}>
                傳一則測試訊息
              </button>
              {/*
                排程功能最難的不是寫，是確認它真的會動。
                沒有這顆按鈕的話，寫完要等到隔天早上才知道自己有沒有寫錯。
              */}
              <button type="button" className="btn btn--outline btn--sm"
                      onClick={async () => {
                        setLineTest('傳送中…')
                        try {
                          const res = await api.lineDailyReport()
                          setLineTest(res.message)
                        } catch (e) {
                          setLineTest(e.message)
                        }
                      }}>
                現在推一次昨天的流量
              </button>
              {lineTest && <span className="small">{lineTest}</span>}
            </div>

            <p className="small muted" style={{ margin: '12px 0 0', lineHeight: 1.9 }}>
              每天 <strong>00:00</strong> 會自動把前一天的流量推到這裡 ——
              幾次瀏覽、幾個人、最多人看哪一頁、客人從哪裡來，
              並且跟前一天比。
              <br />
              <strong>沒有人來的日子也會送。</strong>
              零瀏覽就不吵你的話，「沒收到訊息」會變成兩種意思：
              真的沒人來，或是系統壞了 —— 而這兩件事要做的處理完全相反。
            </p>
          </>
        )}
      </div>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">付款方式</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          勾起來的才會出現在結帳頁。這裡只能<strong>再關掉</strong>，
          不能打開綠界還沒開通的服務 —— 錢收不收得到是綠界那邊決定的。
        </p>

        {checkout && !canOnline && (
          <div className="alert alert--error">
            <strong>線上付款目前是關閉的，只有貨到付款收得到錢。</strong>
            {(ecStatus.warnings || []).length > 0 ? (
              <ul className="small" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {ecStatus.warnings.map((w) => <li key={w} style={{ marginBottom: 4 }}>{w}</li>)}
              </ul>
            ) : (
              <p className="small" style={{ margin: '6px 0 0' }}>
                後端環境變數 <code className="hint-code">ECPAY_ENV</code> 還是
                <code className="hint-code">stage</code>。改成
                <code className="hint-code">production</code> 並填上自己的金流金鑰後才會開通。
              </p>
            )}
          </div>
        )}

        {checkout && canOnline && (
          <div className="alert alert--success">
            <strong>線上付款已開通，客人的付款會真的入帳。</strong>
          </div>
        )}

        <div className="field">
          {PAYMENT_METHODS.map((m) => {
            // 綠界沒開通線上付款時，除了貨到付款都勾了也沒用，直接鎖住
            const locked = !canOnline && m.value !== 'cod' && Boolean(checkout)
            return (
              <label key={m.value} className="check-row" style={{ opacity: locked ? 0.5 : 1 }}>
                <input type="checkbox" checked={isOn(m.value) && !locked} disabled={locked}
                       onChange={() => togglePayment(m.value)} />
                <span>
                  <strong>{m.label}</strong>
                  <span className="small muted" style={{ marginLeft: 8 }}>
                    {locked ? '綠界尚未開通線上付款' : m.note}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="field__hint">
          全部勾選 = 跟著綠界開通的走（建議）。至少要留一種，全關掉等於關店，
          所以系統一定會幫你保留貨到付款。
        </div>
      </form>

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">團購運送說明</h2>
        <div className="alert alert--warn">
          <strong>網站下單的團購組合只能寄到一個地址。</strong>
          <p className="small" style={{ margin: '6px 0 0' }}>
            購物車一筆訂單只收一次運費，綠界也只會產生一個寄件代碼。
            客人如果在備註寫「請幫我分寄三個地址」，系統做不到 ——
            你要嘛自己吸收多出來的兩次運費，要嘛跟已經付完錢的客人解釋。
            所以這段話會自動出現在下單前的每一個地方。
          </p>
        </div>
        {GROUP_BUY_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{f.label}</label>
            <textarea id={f.key} className="textarea" rows={f.rows || 4} name={f.key}
                      value={values[f.key] ?? ''} onChange={change} />
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
