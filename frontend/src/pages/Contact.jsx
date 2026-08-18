import Placeholder from '../components/Placeholder'
import { useAuth } from '../context/AuthContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

/**
 * 「（待補上）」是給工作人員的提醒，客人看到只會覺得這家店沒做完。
 * 所以沒填的欄位對客人是整列隱藏，只有工作人員才看得到提醒。
 */
const Empty = ({ text = '（待補上）' }) => <span className="empty">{text}</span>
const SETTINGS = '/admin/settings'

/** 純座標，例如「25.105821, 121.712378」。Google 地圖右鍵複製出來就是這個格式。 */
const COORD_ONLY = /^\s*(-?\d{1,3}\.\d+)\s*[,，]\s*(-?\d{1,3}\.\d+)\s*$/

/**
 * 台灣門牌的「-6號」在 Google 的資料庫裡常常查不到，會被就近對到「89號」。
 * 送查詢前先補上幾種台灣慣用的寫法，讓 Google 有機會對到正確的點。
 */
function addressQuery(settings) {
  const address = (settings.contact_address || '').trim()
  if (!address) return ''
  // 「89-6號」→「89之6號」。Google 台灣對「之」的辨識率比「-」高。
  const zhi = address.replace(/(\d+)-(\d+)號/g, '$1之$2號')
  // 帶上店名，如果店家有 Google 商家檔案就會優先對到那個點
  const name = (settings.shop_name || '').trim()
  return [name, zhi].filter(Boolean).join(' ')
}

/**
 * 產生可嵌入的 Google 地圖網址。
 *
 * Google 對一般的地圖網址（例如 /maps/place/...）設了 X-Frame-Options，
 * 直接放進 iframe 會被拒絕連線，只有 /maps/embed 或加了 output=embed 的網址可以。
 * 這裡把後台可能貼進來的各種格式都轉成可用的形式，轉不出來就退回用地址產生。
 *
 * 想要地圖上的點「完全精準」，最可靠的方式是在後台的「Google 地圖網址」
 * 直接填座標（在 Google 地圖上對著自家門口按右鍵，最上面那組數字點一下就複製了）。
 * 用地址查是交給 Google 猜的，門牌有 -6、之6 這種細分時它常常對不準。
 */
export function buildMapSrc(settings = {}) {
  const raw = (settings.map_embed_url || '').trim()
  const query = addressQuery(settings)
  const byAddress = query
    ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`
    : ''

  if (raw) {
    // 直接填座標 —— 最精準，優先處理
    const pin = raw.match(COORD_ONLY)
    if (pin) {
      return `https://maps.google.com/maps?q=${pin[1]},${pin[2]}&z=18&output=embed`
    }

    // 使用者可能整段 <iframe ... src="..."> 貼上來
    const iframeSrc = raw.match(/src=["']([^"']+)["']/i)
    const url = iframeSrc ? iframeSrc[1] : raw

    // 已經是可嵌入的形式
    if (/\/maps\/embed/i.test(url) || /[?&]output=embed/i.test(url)) return url

    // 一般分享網址：從中抓出座標 / 地點 / 查詢字串來重組
    const coords = url.match(/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    if (coords) {
      return `https://maps.google.com/maps?q=${coords[1]},${coords[2]}&z=18&output=embed`
    }
    const place = url.match(/\/place\/([^/@?#]+)/)
    if (place) {
      return `https://maps.google.com/maps?q=${place[1]}&z=17&output=embed`
    }
    const q = url.match(/[?&]q=([^&]+)/)
    if (q) {
      return `https://maps.google.com/maps?q=${q[1]}&z=17&output=embed`
    }
    // 短網址（maps.app.goo.gl）在瀏覽器端無法展開，改用地址
    if (byAddress) return byAddress
    // 不是網址而是一段地址文字
    if (!/^https?:\/\//i.test(url)) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&z=17&output=embed`
    }
    return ''
  }

  return byAddress
}

export default function Contact() {
  const { settings } = useSettings()
  const { isStaff } = useAuth()
  const mapSrc = buildMapSrc(settings)

  // field 是後台對應的設定欄位，編輯模式點下去會直接捲到那一格
  // filled 是「這一列有沒有內容」，沒有的話對客人整列隱藏
  const rows = [
    {
      label: '訂購專線',
      field: 'contact_phone',
      filled: Boolean(settings.contact_phone),
      value: settings.contact_phone ? (
        <>
          <a href={`tel:${settings.contact_phone}`}>{settings.contact_phone}</a>
          {settings.contact_phone_2 && (
            <>
              {'　'}
              <a href={`tel:${settings.contact_phone_2}`}>{settings.contact_phone_2}</a>
            </>
          )}
        </>
      ) : (
        <Empty />
      ),
    },
    {
      label: 'LINE',
      field: 'line_id',
      filled: Boolean(settings.line_id),
      value: settings.line_id ? (
        <>
          {settings.line_id}
          {settings.line_url && (
            <>
              {'　'}
              <a href={settings.line_url} target="_blank" rel="noreferrer">加入好友</a>
            </>
          )}
        </>
      ) : (
        <Empty />
      ),
    },
    {
      label: '地址',
      field: 'contact_address',
      hint: '地圖上的位置是 Google 依這個地址推算的。想讓點完全精準，請填「Google 地圖位置（座標）」。',
      filled: Boolean(settings.contact_address),
      value: settings.contact_address ? (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.contact_address)}`}
          target="_blank"
          rel="noreferrer"
        >
          {settings.contact_address}
        </a>
      ) : (
        <Empty />
      ),
    },
    {
      label: 'Email',
      field: 'contact_email',
      filled: Boolean(settings.contact_email),
      value: settings.contact_email ? (
        <a href={`mailto:${settings.contact_email}`}>{settings.contact_email}</a>
      ) : (
        <Empty />
      ),
    },
    {
      label: '營業時間',
      field: 'business_hours',
      filled: Boolean(settings.business_hours),
      value: settings.business_hours || <Empty />,
    },
    {
      label: '溯源編號',
      field: 'traceability_code',
      filled: Boolean(settings.traceability_code),
      value: settings.traceability_code ? (
        <>
          <a
            href={`https://qrc.afa.gov.tw/blog/${settings.traceability_code}`}
            target="_blank"
            rel="noreferrer"
          >
            {settings.traceability_code}
          </a>
          <div className="small muted" style={{ marginTop: 2 }}>
            農業部農糧署溯源農糧產品追溯系統
            {settings.producer_name ? `．生產者 ${settings.producer_name}` : ''}
          </div>
        </>
      ) : (
        <Empty />
      ),
    },
    {
      label: '社群',
      field: 'facebook_url',
      filled: Boolean(settings.facebook_url || settings.instagram_url),
      value:
        settings.facebook_url || settings.instagram_url ? (
          <>
            {settings.facebook_url && (
              <a href={settings.facebook_url} target="_blank" rel="noreferrer">Facebook</a>
            )}
            {settings.facebook_url && settings.instagram_url && '　'}
            {settings.instagram_url && (
              <a href={settings.instagram_url} target="_blank" rel="noreferrer">Instagram</a>
            )}
          </>
        ) : (
          <Empty />
        ),
    },
  ]

  return (
    <>
      <section className="page-hero">
        <div className="container">
          <h1 className="page-hero__title">聯絡我們</h1>
          <p className="page-hero__desc">訂購、團購洽談或任何問題，都歡迎透過以下方式聯絡</p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="contact-grid">
            <div>
              <h2 className="story-row__title" style={{ fontSize: 24, marginBottom: 20 }}>聯絡資訊</h2>
              <div className="contact-list">
                {/* 沒填的欄位對客人整列隱藏，工作人員才看得到「（待補上）」的提醒 */}
                {rows.filter((r) => r.filled || isStaff).map((r) => (
                  <div className="contact-row" key={r.label}
                       {...editable(r.label, SETTINGS, r.field, r.hint)}>
                    <div className="contact-row__label">{r.label}</div>
                    <div className="contact-row__value">{r.value}</div>
                  </div>
                ))}
              </div>

              {/* 這是給自己人看的操作提示，客人不需要知道網站是怎麼維護的 */}
              {isStaff && (
                <p className="small muted" style={{ marginTop: 22 }}>
                  以上聯絡資訊由工作人員於後台「網站設定」維護，更新後前台會立即同步。
                  <br />
                  （這一行與「（待補上）」只有工作人員看得到，客人不會看到。）
                </p>
              )}
            </div>

            <div>
              <div className="line-box">
                <h3 className="line-box__title">用 LINE 聯絡最快</h3>
                <p className="small muted" style={{ margin: 0 }}>
                  加入官方帳號，可直接詢問商品、團購報價與出貨進度
                </p>
                <div className="line-box__id">{settings.line_id || '（LINE ID 待補上）'}</div>
                {settings.line_url ? (
                  <a href={settings.line_url} target="_blank" rel="noreferrer" className="btn btn--primary">
                    加入 LINE 好友
                  </a>
                ) : (
                  <button type="button" className="btn btn--primary" disabled>
                    加入 LINE 好友
                  </button>
                )}
                <div style={{ maxWidth: 180, margin: '22px auto 0' }}
                     {...editable('LINE QR Code', SETTINGS, 'line_qr_url', '正方形圖檔。從 LINE 官方帳號後台可以下載自己的 QR Code。')}>
                  <Placeholder
                    src={settings.line_qr_url}
                    ratio="1x1"
                    hint={'LINE QR Code\n（後台「網站設定 → 圖片」上傳）'}
                    alt="LINE QR Code"
                  />
                </div>
              </div>

              <div style={{ marginTop: 26 }}>
                <h3 className="line-box__title" style={{ marginBottom: 14 }}>位置地圖</h3>
                {mapSrc ? (
                  <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius)', overflow: 'hidden' }}
                       {...editable('位置地圖', SETTINGS, 'map_embed_url', '要讓地圖上的點完全精準，填座標：Google 地圖 → 對著自家門口按右鍵 → 點最上面那組數字 → 貼上。')}>
                    <iframe
                      title="位置地圖"
                      src={mapSrc}
                      width="100%"
                      height="300"
                      style={{ border: 0, display: 'block' }}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                    {/*
                      地圖上那張小卡是 Google 自己標的，門牌細分（89-6 號這種）
                      它常常會就近對到 89 號。所以正確地址一律由我們自己寫在下面，
                      買家看到的地址才會是對的。
                    */}
                    {settings.contact_address && (
                      <div className="map-caption">
                        <strong>{settings.contact_address}</strong>
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(settings.contact_address)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          規劃路線
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <Placeholder ratio="16x9" hint={'地圖\n（後台填入地址後會自動顯示）'} alt="位置地圖" />
                )}
                <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                  地圖上的位置由 Google 依地址推算，可能與實際門牌略有落差，請以上方地址為準。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section section--cream">
        <div className="container">
          <div className="section-head">
            <div className="section-head__eyebrow">Notice</div>
            <h2 className="section-head__title">訂購須知</h2>
          </div>
          <div className="grid grid--3" style={{ maxWidth: 960, margin: '0 auto' }}>
            {[
              ['出貨時間', '訂單確認後約 3-5 個工作天出貨，連假與年節期間會另行公告。'],
              ['運費說明', '單筆訂單滿額免運，未達門檻酌收物流費用，實際金額以訂單確認為準。'],
              ['保存方式', '常溫陰涼處保存，避免日照。低溫結晶屬天然現象，隔水溫熱即可恢復。'],
            ].map(([t, d]) => (
              <div className="panel" key={t}>
                <h3 style={{ fontSize: 16, color: 'var(--honey-800)', marginBottom: 10 }}>{t}</h3>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  )
}
