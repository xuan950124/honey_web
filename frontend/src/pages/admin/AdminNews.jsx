import { useEffect, useState } from 'react'
import { api, formatDate } from '../../api/client'
import ImageUploader from '../../components/ImageUploader'

const EMPTY = {
  title: '', summary: '', content: '', source: '', source_url: '',
  cover_url: null, category: 'news', is_active: true,
}

// 資料庫欄位的實際上限。在這裡先擋，比讓後端噴錯再翻譯友善得多。
// 原文連結與內文是 TEXT，沒有實質上限，所以不列。
const LIMITS = { title: 300, summary: 600, source: 120 }
const LABELS = { title: '標題', summary: '摘要', source: '報導媒體' }

/** 快接近上限時才顯示字數，平常不要干擾。 */
function CharCount({ value = '', max }) {
  const len = (value || '').length
  if (len < max * 0.8) return null
  const over = len > max
  return (
    <span className="small" style={{ color: over ? 'var(--danger)' : 'var(--honey-600)', marginLeft: 8 }}>
      {len} / {max}{over ? '　超過上限了' : ''}
    </span>
  )
}

export default function AdminNews() {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () =>
    api.listNews({ include_inactive: true }).then(setItems).catch((e) => setErr(e.message))

  useEffect(() => { load() }, [])

  const change = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const reset = () => { setForm(EMPTY); setEditingId(null) }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg('')

    const tooLong = Object.entries(LIMITS)
      .filter(([key, max]) => (form[key] || '').length > max)
      .map(([key, max]) => `${LABELS[key]}（${form[key].length} 字，上限 ${max}）`)
    if (tooLong.length) {
      return setErr(`以下欄位太長，請縮短後再儲存：${tooLong.join('、')}`)
    }

    try {
      if (editingId) {
        await api.updateNews(editingId, form)
        setMsg('已更新')
      } else {
        await api.createNews(form)
        setMsg('已新增')
      }
      reset()
      load()
    } catch (error) {
      setErr(error.message)
    }
  }

  const edit = (n) => {
    setEditingId(n.id)
    setForm({
      title: n.title, summary: n.summary || '', content: n.content || '',
      source: n.source || '', source_url: n.source_url || '',
      cover_url: n.cover_url, category: n.category, is_active: n.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (n) => {
    if (!window.confirm(`確定要刪除「${n.title}」嗎？`)) return
    try { await api.deleteNews(n.id); load() } catch (error) { setErr(error.message) }
  }

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">新聞管理</h1>
      </div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">{editingId ? '編輯消息' : '新增消息'}</h2>

        <div className="field">
          <label htmlFor="n-title">
            標題<span className="req">*</span>
            <CharCount value={form.title} max={LIMITS.title} />
          </label>
          <input id="n-title" className="input" name="title" required value={form.title} onChange={change} />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="n-category">類型</label>
            <select id="n-category" className="select" name="category" value={form.category} onChange={change}>
              <option value="news">最新消息</option>
              <option value="media">新聞報導</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="n-source">報導媒體</label>
            <input id="n-source" className="input" name="source" value={form.source} onChange={change} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="n-source_url">原文連結</label>
          <input id="n-source_url" className="input" name="source_url" value={form.source_url} onChange={change}
                 placeholder="https://" />
          <div className="field__hint">
            長度沒有限制，Facebook 那種超長網址（含編碼過的中文標題）直接整條貼上就可以。
            {form.source_url.length > 400 && (
              <span style={{ color: 'var(--honey-600)' }}>　目前 {form.source_url.length} 字元</span>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="n-summary">
            摘要
            <CharCount value={form.summary} max={LIMITS.summary} />
          </label>
          <input id="n-summary" className="input" name="summary" value={form.summary} onChange={change} />
        </div>

        <div className="field">
          <label htmlFor="n-content">內文</label>
          <textarea id="n-content" className="textarea" name="content" value={form.content} onChange={change} />
        </div>

        <ImageUploader
          value={form.cover_url}
          onChange={(url) => setForm((f) => ({ ...f, cover_url: url }))}
          label="封面照片"
          ratio="4x3"
          hint={'封面照片\n（前台不裁切，直式橫式都可以）'}
        />

        <label className="checkbox" style={{ marginBottom: 18 }}>
          <input type="checkbox" name="is_active" checked={form.is_active} onChange={change} />
          公開顯示
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <button type="submit" className="btn btn--primary">{editingId ? '儲存變更' : '新增'}</button>
          {editingId && <button type="button" className="btn btn--ghost" onClick={reset}>取消編輯</button>}
        </div>
      </form>

      <div className="panel" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead>
              <tr><th>標題</th><th>類型</th><th>日期</th><th>狀態</th><th style={{ width: 130 }}>操作</th></tr>
            </thead>
            <tbody>
              {items.map((n) => (
                <tr key={n.id}>
                  <td>{n.title}</td>
                  <td className="small">{n.category === 'media' ? '新聞報導' : '最新消息'}</td>
                  <td className="small">{formatDate(n.published_at)}</td>
                  <td>
                    <span className={`tag tag--${n.is_active ? 'shipped' : 'cancelled'}`}>
                      {n.is_active ? '公開' : '隱藏'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => edit(n)}>編輯</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(n)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan="5" className="muted small" style={{ textAlign: 'center', padding: 28 }}>尚無消息</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
