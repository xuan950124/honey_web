import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import ImageUploader from '../../components/ImageUploader'

const EMPTY = { title: '', subtitle: '', content: '', cover_url: null, sort_order: 0, is_active: true }

export default function AdminStories() {
  const [items, setItems] = useState([])
  const [form, setForm] = useState(EMPTY)
  const [editingId, setEditingId] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = () =>
    api.listStories({ include_inactive: true }).then(setItems).catch((e) => setErr(e.message))

  useEffect(() => { load() }, [])

  const change = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const reset = () => { setForm(EMPTY); setEditingId(null) }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg('')
    const payload = { ...form, sort_order: Number(form.sort_order) || 0 }
    try {
      if (editingId) { await api.updateStory(editingId, payload); setMsg('已更新') }
      else { await api.createStory(payload); setMsg('已新增') }
      reset(); load()
    } catch (error) { setErr(error.message) }
  }

  const edit = (s) => {
    setEditingId(s.id)
    setForm({
      title: s.title, subtitle: s.subtitle || '', content: s.content || '',
      cover_url: s.cover_url, sort_order: s.sort_order, is_active: s.is_active,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const remove = async (s) => {
    if (!window.confirm(`確定要刪除「${s.title}」嗎？`)) return
    try { await api.deleteStory(s.id); load() } catch (error) { setErr(error.message) }
  }

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">故事管理</h1></div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">{editingId ? '編輯故事段落' : '新增故事段落'}</h2>

        <div className="field">
          <label htmlFor="s-title">標題<span className="req">*</span></label>
          <input id="s-title" className="input" name="title" required value={form.title} onChange={change} />
        </div>
        <div className="field">
          <label htmlFor="s-subtitle">副標題</label>
          <input id="s-subtitle" className="input" name="subtitle" value={form.subtitle} onChange={change} />
        </div>
        <div className="field">
          <label htmlFor="s-content">內文</label>
          <textarea id="s-content" className="textarea" name="content" style={{ minHeight: 160 }}
                    value={form.content} onChange={change} />
        </div>

        <ImageUploader
          value={form.cover_url}
          onChange={(url) => setForm((f) => ({ ...f, cover_url: url }))}
          label="故事照片"
          ratio="4x3"
        />

        <div className="field">
          <label htmlFor="s-sort">排序</label>
          <input id="s-sort" className="input" type="number" name="sort_order" value={form.sort_order} onChange={change} />
        </div>

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
              <tr><th>排序</th><th>標題</th><th>副標題</th><th>狀態</th><th style={{ width: 130 }}>操作</th></tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>{s.sort_order}</td>
                  <td>{s.title}</td>
                  <td className="small muted">{s.subtitle}</td>
                  <td>
                    <span className={`tag tag--${s.is_active ? 'shipped' : 'cancelled'}`}>
                      {s.is_active ? '公開' : '隱藏'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => edit(s)}>編輯</button>
                      <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(s)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan="5" className="muted small" style={{ textAlign: 'center', padding: 28 }}>尚無故事段落</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
