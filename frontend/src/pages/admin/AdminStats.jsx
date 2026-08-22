import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { isOptedOut, setOptedOut } from '../../hooks/usePageTracking'

/**
 * 流量統計。
 *
 * ## 為什麼自己做而不是掛 Google Analytics
 *
 * GA 要放追蹤碼、要處理 cookie 同意、資料還在別人家，而店家真正想知道的
 * 只有「今天幾個人來、看了什麼、從哪裡來」。這三件事自己存就有了。
 *
 * ## 數字的誠實說明
 *
 * 「不重複訪客」是用**每天更換的鹽**去雜湊 IP 算出來的，所以
 * **同一個人隔天再來會被算成兩位**。這是為了不能反推 IP、不能跨日追蹤，
 * 換來的代價。畫面上要講清楚，不然會以為系統算錯。
 */

const RANGES = [
  { days: 7, label: '最近 7 天' },
  { days: 30, label: '最近 30 天' },
  { days: 90, label: '最近 90 天' },
]

function Bar({ value, max }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ background: 'var(--cream-2)', borderRadius: 3, height: 8, flex: 1 }}>
      <div style={{
        width: `${pct}%`, height: '100%', borderRadius: 3,
        background: 'var(--honey-500)',
      }} />
    </div>
  )
}

export default function AdminStats() {
  const [data, setData] = useState(null)
  const [days, setDays] = useState(30)
  const [err, setErr] = useState('')
  const [excluded, setExcluded] = useState(isOptedOut())

  useEffect(() => {
    setData(null)
    api.statsSummary(days).then(setData).catch((e) => setErr(e.message))
  }, [days])

  const maxDaily = Math.max(1, ...(data?.daily || []).map((d) => d.views))
  const maxPage = Math.max(1, ...(data?.top_pages || []).map((p) => p.views))

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">流量統計</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGES.map((r) => (
            <button type="button" key={r.days}
                    className={`chip${days === r.days ? ' active' : ''}`}
                    onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="alert alert--error">{err}</div>}
      {!data && !err && <div className="loading">載入中…</div>}

      {data && (
        <>
          <div className="order-stats">
            <div className="order-stat">
              <div className="order-stat__num">{data.today.views}</div>
              <div className="order-stat__label">
                今天瀏覽　<span className="muted">{data.today.visitors} 人</span>
              </div>
            </div>
            <div className="order-stat">
              <div className="order-stat__num">{data.week.views}</div>
              <div className="order-stat__label">
                最近 7 天　<span className="muted">{data.week.visitors} 人</span>
              </div>
            </div>
            <div className="order-stat">
              <div className="order-stat__num">{data.range.views}</div>
              <div className="order-stat__label">
                最近 {data.days} 天　<span className="muted">{data.range.visitors} 人</span>
              </div>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel__title">每天的瀏覽量</h2>
            {data.daily.length ? (
              <table className="spec-table spec-table--wide">
                <tbody>
                  {data.daily.slice().reverse().map((d) => (
                    <tr key={d.day}>
                      <th style={{ whiteSpace: 'nowrap' }}>{d.day}</th>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Bar value={d.views} max={maxDaily} />
                          <span style={{ minWidth: 90, textAlign: 'right' }}>
                            {d.views} 次
                            <span className="muted small">　{d.visitors} 人</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">這段期間還沒有紀錄。</p>
            )}
          </div>

          <div className="panel">
            <h2 className="panel__title">最多人看的頁面</h2>
            {data.top_pages.length ? (
              <table className="spec-table spec-table--wide">
                <tbody>
                  {data.top_pages.map((p) => (
                    <tr key={p.path}>
                      <th style={{ whiteSpace: 'nowrap' }}>
                        <a href={p.path} target="_blank" rel="noreferrer">{p.path}</a>
                      </th>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Bar value={p.views} max={maxPage} />
                          <span style={{ minWidth: 90, textAlign: 'right' }}>
                            {p.views} 次
                            <span className="muted small">　{p.visitors} 人</span>
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">還沒有資料。</p>
            )}
          </div>

          <div className="panel">
            <h2 className="panel__title">客人從哪裡來</h2>
            <p className="small muted" style={{ marginTop: -8 }}>
              只記錄來源網域，不記完整網址。
              「直接輸入網址或從書籤」也包含從 LINE、Instagram 這類 App 點進來的
              —— 那些 App 通常不會告訴網站來源。
            </p>
            {data.sources.length ? (
              <table className="spec-table spec-table--wide">
                <tbody>
                  {data.sources.map((s) => (
                    <tr key={s.host}>
                      <th style={{ whiteSpace: 'nowrap' }}>{s.host}</th>
                      <td>{s.views} 次</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted small">還沒有資料。</p>
            )}
          </div>

          {/*
            排除設定。「你自己不要被算進去」是這個功能最重要的一件事 ——
            你每天開十次自己的網站，那些數字會蓋掉真實客人的樣子。
          */}
          <div className="panel">
            <h2 className="panel__title">哪些人不會被計入</h2>
            <ul className="small" style={{ margin: '0 0 16px', paddingLeft: 20, lineHeight: 2 }}>
              <li>
                <strong>登入中的工作人員</strong> —— 你在後台操作、逛自己的網站都不算，
                不用做任何設定
              </li>
              <li>
                <strong>勾了下面那個開關的裝置</strong> —— 沒登入時也不算
                （設定存在這台瀏覽器裡）
              </li>
              <li><strong>爬蟲與監測服務</strong> —— Google、Facebook 的抓取程式</li>
              <li>
                <strong>後台、購物車、訂單頁</strong> —— 那不是「客人在逛」，
                算進去只會讓數字虛胖
              </li>
              <li><strong>手機版預覽</strong> —— 那是同一個人在看同一頁</li>
            </ul>

            <label className="check-row">
              <input type="checkbox" checked={excluded}
                     onChange={(e) => {
                       setOptedOut(e.target.checked)
                       setExcluded(e.target.checked)
                     }} />
              <span>
                <strong>這台裝置不要計入瀏覽統計</strong>
                <span className="small muted" style={{ marginLeft: 8 }}>
                  登出後、用無痕視窗看自己的網站時會用到。
                  換瀏覽器或清掉瀏覽資料要重新勾。
                </span>
              </span>
            </label>
          </div>

          <div className="panel">
            <h2 className="panel__title">關於這些數字</h2>
            <p className="small muted" style={{ margin: 0, lineHeight: 2 }}>
              <strong>不會記錄 IP。</strong> 要算「幾個人」又需要分辨是不是同一個人，
              所以存的是雜湊值，而且<strong>每天換一組鹽</strong> ——
              既反推不回原始 IP，也追蹤不了跨日的同一個人。
              <br />
              代價是：<strong>同一個人今天來、明天再來，會被算成兩位訪客。</strong>
              所以「人數」看趨勢就好，不要當成精確的人頭數。
              <br />
              紀錄保留 {data.retention_days} 天，更舊的會自動刪掉
              （目前存了 {data.total_rows.toLocaleString('zh-TW')} 筆）。
            </p>
          </div>
        </>
      )}
    </>
  )
}
