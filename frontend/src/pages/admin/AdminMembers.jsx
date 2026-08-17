import { useEffect, useState } from 'react'
import { api, formatDate, formatPrice } from '../../api/client'
import CouponCard from '../../components/CouponCard'

export default function AdminMembers() {
  const [members, setMembers] = useState([])
  const [coupons, setCoupons] = useState([])
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('members')

  const load = (kw = '') => {
    setLoading(true)
    api.adminMembers(kw).then(setMembers).catch((e) => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (tab === 'coupons') api.adminCoupons().then(setCoupons).catch((e) => setErr(e.message))
  }, [tab])

  const search = (e) => { e.preventDefault(); load(keyword) }

  const totalSpent = members.reduce((s, m) => s + Number(m.total_spent || 0), 0)
  const verified = members.filter((m) => m.email_verified).length

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">會員管理</h1></div>
      {err && <div className="alert alert--error">{err}</div>}

      <div className="stat-grid">
        <div className="stat"><div className="stat__label">會員人數</div><div className="stat__num">{members.length}</div></div>
        <div className="stat"><div className="stat__label">已驗證信箱</div><div className="stat__num">{verified}</div></div>
        <div className="stat">
          <div className="stat__label">累積消費總額</div>
          <div className="stat__num" style={{ fontSize: 22 }}>NT${formatPrice(totalSpent)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">平均客單累積</div>
          <div className="stat__num" style={{ fontSize: 22 }}>
            NT${formatPrice(members.length ? Math.round(totalSpent / members.length) : 0)}
          </div>
        </div>
      </div>

      <div className="filter-bar" style={{ justifyContent: 'flex-start', marginBottom: 20 }}>
        <button type="button" className={`chip${tab === 'members' ? ' active' : ''}`}
                onClick={() => setTab('members')}>會員列表</button>
        <button type="button" className={`chip${tab === 'coupons' ? ' active' : ''}`}
                onClick={() => setTab('coupons')}>已發放折價券</button>
      </div>

      {tab === 'members' && (
        <>
          <form className="panel" onSubmit={search} style={{ paddingBottom: 20 }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 1, minWidth: 200 }}
                     placeholder="搜尋姓名、Email 或電話"
                     value={keyword} onChange={(e) => setKeyword(e.target.value)} />
              <button type="submit" className="btn btn--primary">搜尋</button>
              {keyword && (
                <button type="button" className="btn btn--ghost"
                        onClick={() => { setKeyword(''); load() }}>清除</button>
              )}
            </div>
          </form>

          <div className="panel" style={{ padding: 0 }}>
            {loading ? (
              <div className="loading">載入中…</div>
            ) : members.length ? (
              <div className="table-wrap" style={{ border: 'none' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>會員</th><th>等級</th><th>累積消費</th>
                      <th>訂單數</th><th>可用券</th><th>信箱</th><th>加入日期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td>
                          {m.name}
                          <div className="small muted">{m.email}</div>
                          {m.phone && <div className="small muted">{m.phone}</div>}
                        </td>
                        <td>
                          {m.tier_name ? (
                            <span className="tag tag--member">{m.tier_name}</span>
                          ) : (
                            <span className="small muted">－</span>
                          )}
                        </td>
                        <td style={{ fontWeight: 500 }}>NT${formatPrice(m.total_spent)}</td>
                        <td>{m.order_count}</td>
                        <td>{m.coupon_count}</td>
                        <td>
                          <span className={`tag tag--${m.email_verified ? 'shipped' : 'pending'}`}>
                            {m.email_verified ? '已驗證' : '未驗證'}
                          </span>
                        </td>
                        <td className="small">{formatDate(m.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-state__title">
                  {keyword ? '找不到符合的會員' : '還沒有會員註冊'}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'coupons' && (
        <div className="panel">
          <h2 className="panel__title">已發放的折價券（最近 300 筆）</h2>
          <p className="small muted" style={{ marginTop: -8 }}>
            券是依「會員等級與折價券」頁的規則自動發放的。這裡只能查看，不能手動發券。
          </p>
          {coupons.length ? (
            <div className="coupon-list">
              {coupons.map((cp) => <CouponCard key={cp.id} coupon={cp} />)}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>還沒有發出任何折價券。</p>
          )}
        </div>
      )}
    </>
  )
}
