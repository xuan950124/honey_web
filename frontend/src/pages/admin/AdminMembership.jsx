import { useEffect, useState } from 'react'
import { COUPON_KIND_TEXT, COUPON_TRIGGER_TEXT, api, formatPrice } from '../../api/client'

const EMPTY_TIER = { name: '', min_spent: 0, discount_percent: 0, note: '', sort_order: 0, is_active: true }
const EMPTY_RULE = {
  name: '', trigger: 'total_spent', threshold: 0, kind: 'fixed', value: 0,
  min_order_amount: 0, max_discount: '', valid_days: 90, is_active: true, sort_order: 0,
}

export default function AdminMembership() {
  const [tiers, setTiers] = useState([])
  const [rules, setRules] = useState([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [tier, setTier] = useState(EMPTY_TIER)
  const [tierId, setTierId] = useState(null)
  const [rule, setRule] = useState(EMPTY_RULE)
  const [ruleId, setRuleId] = useState(null)

  const load = () => {
    api.adminTiers().then(setTiers).catch((e) => setErr(e.message))
    api.adminCouponRules().then(setRules).catch((e) => setErr(e.message))
  }
  useEffect(load, [])

  const changeTier = (e) => {
    const { name, value, type, checked } = e.target
    setTier((t) => ({ ...t, [name]: type === 'checkbox' ? checked : value }))
  }
  const changeRule = (e) => {
    const { name, value, type, checked } = e.target
    setRule((r) => ({ ...r, [name]: type === 'checkbox' ? checked : value }))
  }

  const saveTier = async (e) => {
    e.preventDefault(); setErr(''); setMsg('')
    const payload = {
      ...tier,
      min_spent: Number(tier.min_spent) || 0,
      discount_percent: Number(tier.discount_percent) || 0,
      sort_order: Number(tier.sort_order) || 0,
      note: tier.note || null,
    }
    try {
      if (tierId) await api.updateTier(tierId, payload)
      else await api.createTier(payload)
      setMsg('會員等級已儲存')
      setTier(EMPTY_TIER); setTierId(null); load()
    } catch (error) { setErr(error.message) }
  }

  const saveRule = async (e) => {
    e.preventDefault(); setErr(''); setMsg('')
    const payload = {
      ...rule,
      threshold: Number(rule.threshold) || 0,
      value: Number(rule.value) || 0,
      min_order_amount: Number(rule.min_order_amount) || 0,
      max_discount: rule.max_discount === '' ? null : Number(rule.max_discount),
      valid_days: Number(rule.valid_days) || 0,
      sort_order: Number(rule.sort_order) || 0,
    }
    try {
      if (ruleId) await api.updateCouponRule(ruleId, payload)
      else await api.createCouponRule(payload)
      setMsg('發券規則已儲存')
      setRule(EMPTY_RULE); setRuleId(null); load()
    } catch (error) { setErr(error.message) }
  }

  const editTier = (t) => {
    setTierId(t.id)
    setTier({ ...t, note: t.note || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const editRule = (r) => {
    setRuleId(r.id)
    setRule({ ...r, max_discount: r.max_discount ?? '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removeTier = async (t) => {
    if (!window.confirm(`確定要刪除「${t.name}」嗎？已在此等級的會員會自動降到符合的等級。`)) return
    try { await api.deleteTier(t.id); load() } catch (e) { setErr(e.message) }
  }
  const removeRule = async (r) => {
    if (!window.confirm(`確定要刪除「${r.name}」嗎？已經發出去的券不會受影響。`)) return
    try { await api.deleteCouponRule(r.id); load() } catch (e) { setErr(e.message) }
  }

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">會員等級與折價券</h1></div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      {/* 會員等級 */}
      <form className="panel" onSubmit={saveTier}>
        <h2 className="panel__title">{tierId ? '編輯會員等級' : '新增會員等級'}</h2>
        <p className="small muted" style={{ marginTop: -8 }}>
          等級依「累積消費金額」自動判定，符合門檻中最高的那一級。折扣會自動套用在每筆訂單的商品金額上。
        </p>

        <div className="form-row">
          <div className="field">
            <label htmlFor="t-name">等級名稱<span className="req">*</span></label>
            <input id="t-name" className="input" name="name" required value={tier.name} onChange={changeTier}
                   placeholder="例：金卡會員" />
          </div>
          <div className="field">
            <label htmlFor="t-min">累積消費門檻</label>
            <input id="t-min" className="input" type="number" min="0" name="min_spent"
                   value={tier.min_spent} onChange={changeTier} />
            <div className="field__hint">最低那一級請填 0，代表註冊就有</div>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="t-disc">訂單折扣（%）</label>
            <input id="t-disc" className="input" type="number" min="0" max="100" step="0.5"
                   name="discount_percent" value={tier.discount_percent} onChange={changeTier} />
            <div className="field__hint">
              填 5 代表 95 折。目前設定：
              {Number(tier.discount_percent) > 0
                ? `${(100 - Number(tier.discount_percent)) / 10} 折`
                : '無折扣'}
            </div>
          </div>
          <div className="field">
            <label htmlFor="t-sort">排序</label>
            <input id="t-sort" className="input" type="number" name="sort_order"
                   value={tier.sort_order} onChange={changeTier} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="t-note">說明</label>
          <input id="t-note" className="input" name="note" value={tier.note} onChange={changeTier}
                 placeholder="會顯示在會員中心的等級表" />
        </div>

        <label className="checkbox" style={{ marginBottom: 18 }}>
          <input type="checkbox" name="is_active" checked={tier.is_active} onChange={changeTier} />
          啟用
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn btn--primary">{tierId ? '儲存變更' : '新增等級'}</button>
          {tierId && (
            <button type="button" className="btn btn--ghost"
                    onClick={() => { setTier(EMPTY_TIER); setTierId(null) }}>
              取消編輯
            </button>
          )}
        </div>
      </form>

      <div className="panel" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr><th>等級</th><th>門檻</th><th>折扣</th><th>狀態</th><th style={{ width: 130 }}>操作</th></tr>
            </thead>
            <tbody>
              {tiers.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.name}
                    {t.note && <div className="small muted">{t.note}</div>}
                  </td>
                  <td>NT${formatPrice(t.min_spent)}</td>
                  <td>
                    {Number(t.discount_percent) > 0
                      ? `${(100 - Number(t.discount_percent)) / 10} 折`
                      : '－'}
                  </td>
                  <td>
                    <span className={`tag tag--${t.is_active ? 'shipped' : 'cancelled'}`}>
                      {t.is_active ? '啟用' : '停用'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => editTier(t)}>編輯</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => removeTier(t)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!tiers.length && (
                <tr><td colSpan="5" className="muted small" style={{ textAlign: 'center', padding: 28 }}>尚無等級</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 發券規則 */}
      <form className="panel" onSubmit={saveRule}>
        <h2 className="panel__title">{ruleId ? '編輯發券規則' : '新增發券規則'}</h2>
        <div className="alert alert--info">
          規則是「自動發券的條件」。同一條規則對同一位會員<strong>只會發一次</strong>。
          修改規則不會影響已經發出去的券 —— 券在發放當下就把條件寫死了。
        </div>

        <div className="field">
          <label htmlFor="r-name">規則名稱<span className="req">*</span></label>
          <input id="r-name" className="input" name="name" required value={rule.name} onChange={changeRule}
                 placeholder="例：累積消費滿 3,000 元回饋。這也會是買家看到的券名稱" />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="r-trigger">發放時機</label>
            <select id="r-trigger" className="select" name="trigger" value={rule.trigger} onChange={changeRule}>
              <option value="total_spent">累積消費達標</option>
              <option value="register">新會員註冊禮</option>
            </select>
            {rule.trigger === 'register' && (
              <div className="field__hint">會在會員<strong>完成信箱驗證後</strong>發放，避免假帳號領券</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="r-threshold">累積消費門檻</label>
            <input id="r-threshold" className="input" type="number" min="0" name="threshold"
                   value={rule.threshold} onChange={changeRule}
                   disabled={rule.trigger === 'register'} />
            <div className="field__hint">
              {rule.trigger === 'register' ? '註冊禮不需要門檻' : '累積消費達到這個金額就發券'}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="r-kind">折價券類型</label>
            <select id="r-kind" className="select" name="kind" value={rule.kind} onChange={changeRule}>
              <option value="fixed">折固定金額</option>
              <option value="percent">百分比折扣</option>
              <option value="free_shipping">免運</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="r-value">
              {rule.kind === 'percent' ? '折扣百分比' : rule.kind === 'fixed' ? '折抵金額' : '（免運不需填）'}
            </label>
            <input id="r-value" className="input" type="number" min="0" name="value"
                   value={rule.value} onChange={changeRule}
                   disabled={rule.kind === 'free_shipping'} />
            <div className="field__hint">
              {rule.kind === 'percent' ? '填 10 代表全單 9 折' : rule.kind === 'fixed' ? '直接折抵的元數' : ''}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="r-min">使用門檻（訂單滿多少才能用）</label>
            <input id="r-min" className="input" type="number" min="0" name="min_order_amount"
                   value={rule.min_order_amount} onChange={changeRule} />
            <div className="field__hint">填 0 代表無門檻。建議設定，避免小額訂單虧本</div>
          </div>
          <div className="field">
            <label htmlFor="r-max">折抵上限</label>
            <input id="r-max" className="input" type="number" min="0" name="max_discount"
                   value={rule.max_discount} onChange={changeRule}
                   disabled={rule.kind !== 'percent'} />
            <div className="field__hint">
              {rule.kind === 'percent'
                ? '百分比券建議設上限，避免大額訂單損失過多'
                : '只有百分比券需要'}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="r-days">有效天數</label>
            <input id="r-days" className="input" type="number" min="0" name="valid_days"
                   value={rule.valid_days} onChange={changeRule} />
            <div className="field__hint">從發放日算起。填 0 代表永久有效（不建議）</div>
          </div>
          <div className="field">
            <label htmlFor="r-sort">排序</label>
            <input id="r-sort" className="input" type="number" name="sort_order"
                   value={rule.sort_order} onChange={changeRule} />
          </div>
        </div>

        <label className="checkbox" style={{ marginBottom: 18 }}>
          <input type="checkbox" name="is_active" checked={rule.is_active} onChange={changeRule} />
          啟用（停用後不再發新券，已發出的不受影響）
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn btn--primary">{ruleId ? '儲存變更' : '新增規則'}</button>
          {ruleId && (
            <button type="button" className="btn btn--ghost"
                    onClick={() => { setRule(EMPTY_RULE); setRuleId(null) }}>
              取消編輯
            </button>
          )}
        </div>
      </form>

      <div className="panel" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr>
                <th>規則</th><th>時機</th><th>優惠</th><th>使用門檻</th>
                <th>效期</th><th>狀態</th><th style={{ width: 130 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="small">
                    {COUPON_TRIGGER_TEXT[r.trigger]}
                    {r.trigger === 'total_spent' && (
                      <div className="muted">滿 NT${formatPrice(r.threshold)}</div>
                    )}
                  </td>
                  <td className="small">
                    {r.kind === 'free_shipping'
                      ? '免運'
                      : r.kind === 'percent'
                        ? `${Number(r.value)}% 折扣${r.max_discount ? `（上限 ${formatPrice(r.max_discount)}）` : ''}`
                        : `折 NT$${formatPrice(r.value)}`}
                  </td>
                  <td className="small">
                    {Number(r.min_order_amount) > 0 ? `滿 NT$${formatPrice(r.min_order_amount)}` : '無'}
                  </td>
                  <td className="small">{r.valid_days > 0 ? `${r.valid_days} 天` : '永久'}</td>
                  <td>
                    <span className={`tag tag--${r.is_active ? 'shipped' : 'cancelled'}`}>
                      {r.is_active ? '啟用' : '停用'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => editRule(r)}>編輯</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => removeRule(r)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!rules.length && (
                <tr><td colSpan="7" className="muted small" style={{ textAlign: 'center', padding: 28 }}>尚無規則</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
