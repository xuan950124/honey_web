import Placeholder from '../components/Placeholder'
import { buildMapSrc, directionsUrl, mapPoint } from '../lib/maps'
import { useAuth } from '../context/AuthContext'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

/**
 * 「（待補上）」是給工作人員的提醒，客人看到只會覺得這家店沒做完。
 * 所以沒填的欄位對客人是整列隱藏，只有工作人員才看得到提醒。
 */
const Empty = ({ text = '（待補上）' }) => <span className="empty">{text}</span>
const SETTINGS = '/admin/settings'

export default function Contact() {
  const { settings } = useSettings()
  const { isStaff } = useAuth()
  const mapSrc = buildMapSrc(settings)
  // 有沒有填精確座標。有的話地圖與導航都不必靠 Google 猜地址
  const hasPoint = Boolean(mapPoint(settings))

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
                          href={directionsUrl(settings)}
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
                {/*
                  有座標時，地圖與導航都指到那個點，沒有誤差可言，不需要再道歉。
                  沒座標時才提醒客人以文字地址為準。
                */}
                {!hasPoint && (
                  <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                    地圖上的位置由 Google 依地址推算，可能與實際門牌略有落差，請以上方地址為準。
                  </p>
                )}

                {isStaff && !hasPoint && (
                  <div className="alert alert--info" style={{ marginTop: 12, marginBottom: 0 }}>
                    <strong>地圖與「規劃路線」現在都是靠 Google 猜地址</strong>
                    <p className="small" style={{ margin: '6px 0 0' }}>
                      「89-6號」這種細分門牌它會就近對到「89號」，
                      <strong>客人按規劃路線會被導到隔壁</strong>。
                      到「網站設定 → Google 地圖位置（座標）」填座標就兩個都準了：
                      打開 Google 地圖 → 對著自家門口按右鍵 → 點最上面那組數字（自動複製）→ 貼上。
                      （這段只有工作人員看得到。）
                    </p>
                  </div>
                )}
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
          <div className="grid grid--2" style={{ maxWidth: 960, margin: '0 auto' }}>
            {[
              ['出貨時間', '訂單確認後約 3-5 個工作天出貨，連假與年節期間會另行公告。'],
              ['運費說明', '單筆訂單滿額免運，未達門檻酌收物流費用，實際金額以訂單確認為準。'],
              ['保存方式', '常溫陰涼處保存，避免日照。低溫結晶屬天然現象，隔水溫熱即可恢復。'],
              // 公司行號團購最在意報帳憑證，講在前面比出貨後才解釋好得多
              ['購買憑證', '本場為自產自銷養蜂場，依營業稅法免辦營業登記，開立「農民收據」'
                + '而非統一發票。需要指定抬頭請於訂單備註寫明；公司行號核銷規定不一，'
                + '建議先與貴單位會計確認。'],
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
