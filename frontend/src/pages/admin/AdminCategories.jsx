import { useEffect, useState } from 'react'
import { api } from '../../api/client'

export default function AdminCategories() {
  const [items, setItems] = useState([])
  const [form, setForm] = useState({ name: '', slug: '', sort_order: 0 })
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = () => api.listCategories().then(setItems).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const change = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg('')
    try {
      await api.createCategory({ ...form, sort_order: Number(form.sort_order) || 0 })
      setForm({ name: '', slug: '', sort_order: 0 })
      setMsg('分類已新增')
      load()
    } catch (error) { setErr(error.message) }
  }

  const remove = async (c) => {
    if (!window.confirm(`確定要刪除分類「${c.name}」嗎？該分類下的商品會變成未分類。`)) return
    try { await api.deleteCategory(c.id); load() } catch (error) { setErr(error.message) }
  }

  return (
    <>
      <div className="admin-head"><h1 className="admin-head__title">分類管理</h1></div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <form className="panel" onSubmit={submit}>
        <h2 className="panel__title">新增分類</h2>
        <div className="form-row">
          <div className="field">
            <label htmlFor="c-name">分類名稱<span className="req">*</span></label>
            <input id="c-name" className="input" name="name" required value={form.name} onChange={change}
                   placeholder="例：純蜂蜜" />
          </div>
          <div className="field">
            <label htmlFor="c-slug">網址代稱<span className="req">*</span></label>
            <input id="c-slug" className="input" name="slug" required value={form.slug} onChange={change}
                   placeholder="例：pure-honey（限英文小寫與連字號）" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="c-sort">排序</label>
          <input id="c-sort" className="input" type="number" name="sort_order" value={form.sort_order} onChange={change} />
        </div>
        <button type="submit" className="btn btn--primary">新增分類</button>
      </form>

      <div className="panel" style={{ padding: 0 }}>
        <div className="table-wrap" style={{ border: 'none' }}>
          <table className="table">
            <thead><tr><th>排序</th><th>名稱</th><th>代稱</th><th style={{ width: 100 }}>操作</th></tr></thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id}>
                  <td>{c.sort_order}</td>
                  <td>{c.name}</td>
                  <td className="small" style={{ fontFamily: 'monospace' }}>{c.slug}</td>
                  <td>
                    <button type="button" className="btn btn--danger btn--sm" onClick={() => remove(c)}>刪除</button>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan="4" className="muted small" style={{ textAlign: 'center', padding: 28 }}>尚無分類</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
