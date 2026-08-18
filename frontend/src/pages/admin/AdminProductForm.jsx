import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client'
import ImageUploader from '../../components/ImageUploader'
import Placeholder from '../../components/Placeholder'

const EMPTY = {
  name: '', subtitle: '', description: '', spec: '', origin: '',
  price: 0, original_price: '', stock: 0, image_url: null,
  is_group_buy: false, group_buy_min_qty: '', group_buy_note: '',
  is_featured: false, is_active: true, sort_order: 0, category_id: '',
  // 食品標示。留空會用「政策條款 → 食品標示預設值」的共用內容
  ingredients: '', net_weight: '', shelf_life: '', storage: '',
  nutrition: '', allergens: '', additives: '',
}

// 這些欄位留空時會退回共用預設值，所以不是每個都非填不可
const FOOD_FIELDS = [
  { key: 'ingredients', label: '內容物名稱', hint: '留空用共用預設。純蜜請寫「100% 蜂蜜」' },
  { key: 'net_weight', label: '淨重／內容量', hint: '例：700 公克。留空會用上面的「規格」' },
  { key: 'shelf_life', label: '有效日期／保存期限', hint: '例：製造日期起 2 年（瓶身標示為準）' },
  { key: 'storage', label: '保存方式', hint: '留空用共用預設', textarea: true },
  { key: 'additives', label: '食品添加物名稱', hint: '純蜜沒有添加物就留空' },
  { key: 'allergens', label: '過敏原資訊', hint: '留空用共用預設' },
  { key: 'nutrition', label: '營養標示', hint: '每 100 公克的熱量、蛋白質、脂肪、碳水化合物、糖、鈉', textarea: true },
]

export default function AdminProductForm() {
  const { id } = useParams()
  const isEdit = id && id !== 'new'
  const navigate = useNavigate()

  const [form, setForm] = useState(EMPTY)
  const [categories, setCategories] = useState([])
  const [images, setImages] = useState([])
  const [extraUrl, setExtraUrl] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.listCategories().then(setCategories).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit) return
    api
      .getProduct(id)
      .then((p) => {
        setForm({
          ...EMPTY,
          ...p,
          original_price: p.original_price ?? '',
          group_buy_min_qty: p.group_buy_min_qty ?? '',
          category_id: p.category?.id ?? '',
          subtitle: p.subtitle ?? '', description: p.description ?? '',
          spec: p.spec ?? '', origin: p.origin ?? '', group_buy_note: p.group_buy_note ?? '',
          ...Object.fromEntries(FOOD_FIELDS.map((f) => [f.key, p[f.key] ?? ''])),
        })
        setImages(p.images || [])
      })
      .catch((e) => setErr(e.message))
  }, [id, isEdit])

  const change = (e) => {
    const { name, value, type, checked } = e.target
    setForm((f) => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setMsg(''); setSaving(true)
    const payload = {
      ...form,
      price: Number(form.price) || 0,
      original_price: form.original_price === '' ? null : Number(form.original_price),
      stock: Number(form.stock) || 0,
      sort_order: Number(form.sort_order) || 0,
      group_buy_min_qty: form.group_buy_min_qty === '' ? null : Number(form.group_buy_min_qty),
      category_id: form.category_id === '' ? null : Number(form.category_id),
      subtitle: form.subtitle || null, description: form.description || null,
      spec: form.spec || null, origin: form.origin || null, group_buy_note: form.group_buy_note || null,
      ...Object.fromEntries(FOOD_FIELDS.map((f) => [f.key, form[f.key] || null])),
    }
    delete payload.id; delete payload.category; delete payload.images

    try {
      if (isEdit) {
        await api.updateProduct(id, payload)
        setMsg('商品已更新')
      } else {
        const created = await api.createProduct(payload)
        navigate(`/admin/products/${created.id}`, { replace: true })
        setMsg('商品已建立，可繼續加入其他照片')
      }
    } catch (error) {
      setErr(error.message)
    } finally {
      setSaving(false)
    }
  }

  const addExtraImage = async () => {
    if (!extraUrl) return
    try {
      const img = await api.addProductImage(id, extraUrl)
      setImages((prev) => [...prev, img])
      setExtraUrl(null)
    } catch (error) {
      setErr(error.message)
    }
  }

  const removeExtraImage = async (imgId) => {
    try {
      await api.deleteProductImage(imgId)
      setImages((prev) => prev.filter((i) => i.id !== imgId))
    } catch (error) {
      setErr(error.message)
    }
  }

  return (
    <>
      <div className="admin-head">
        <h1 className="admin-head__title">{isEdit ? '編輯商品' : '新增商品'}</h1>
        <button type="button" className="btn btn--ghost" onClick={() => navigate('/admin/products')}>
          ← 回商品列表
        </button>
      </div>

      {err && <div className="alert alert--error">{err}</div>}
      {msg && <div className="alert alert--success">{msg}</div>}

      <form onSubmit={submit}>
        <div className="panel">
          <h2 className="panel__title">基本資料</h2>

          <div className="field">
            <label htmlFor="name">商品名稱<span className="req">*</span></label>
            <input id="name" className="input" name="name" required value={form.name} onChange={change} />
          </div>

          <div className="field">
            <label htmlFor="subtitle">副標題</label>
            <input id="subtitle" className="input" name="subtitle" value={form.subtitle} onChange={change}
                   placeholder="例：濃郁焦糖香氣，經典國產花蜜" />
          </div>

          <div className="form-row">
            <div className="field">
              <label htmlFor="spec">規格</label>
              <input id="spec" className="input" name="spec" value={form.spec} onChange={change} placeholder="700g / 玻璃瓶" />
            </div>
            <div className="field">
              <label htmlFor="origin">產地</label>
              <input id="origin" className="input" name="origin" value={form.origin} onChange={change} placeholder="台南 東山" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="category_id">分類</label>
            <select id="category_id" className="select" name="category_id" value={form.category_id} onChange={change}>
              <option value="">未分類</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="description">商品介紹</label>
            <textarea id="description" className="textarea" name="description" value={form.description} onChange={change} />
          </div>
        </div>

        <div className="panel">
          <h2 className="panel__title">價格與庫存</h2>
          <div className="form-row">
            <div className="field">
              <label htmlFor="price">售價（NT$）<span className="req">*</span></label>
              <input id="price" className="input" type="number" min="0" name="price" required value={form.price} onChange={change} />
            </div>
            <div className="field">
              <label htmlFor="original_price">原價（選填）</label>
              <input id="original_price" className="input" type="number" min="0" name="original_price"
                     value={form.original_price} onChange={change} />
              <div className="field__hint">填寫後前台會顯示劃線原價與「優惠」標籤</div>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="stock">庫存數量</label>
              <input id="stock" className="input" type="number" min="0" name="stock" value={form.stock} onChange={change} />
            </div>
            <div className="field">
              <label htmlFor="sort_order">排序（數字小的排前面）</label>
              <input id="sort_order" className="input" type="number" name="sort_order" value={form.sort_order} onChange={change} />
            </div>
          </div>
        </div>

        <div className="panel">
          <h2 className="panel__title">商品照片</h2>
          <ImageUploader
            value={form.image_url}
            onChange={(url) => setForm((f) => ({ ...f, image_url: url }))}
            label="主圖"
            hint="尚未上傳（前台顯示空白）"
          />

          {isEdit && (
            <>
              <div className="pd__divider" />
              <label style={{ display: 'block', fontSize: 13.5, fontWeight: 500, color: 'var(--honey-800)', marginBottom: 10 }}>
                其他照片
              </label>
              <div className="thumb-row">
                {images.map((img) => (
                  <div className="thumb" key={img.id}>
                    <Placeholder src={img.image_url} ratio="1x1" alt={img.caption || ''} />
                    <button type="button" className="thumb__del" onClick={() => removeExtraImage(img.id)} aria-label="刪除">
                      ×
                    </button>
                  </div>
                ))}
                {!images.length && <p className="small muted" style={{ margin: 0 }}>尚未加入其他照片</p>}
              </div>
              <div style={{ marginTop: 16 }}>
                <ImageUploader value={extraUrl} onChange={setExtraUrl} label="上傳新照片" />
                <button type="button" className="btn btn--outline btn--sm" onClick={addExtraImage} disabled={!extraUrl}>
                  加入這張照片
                </button>
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2 className="panel__title">食品標示</h2>
          <div className="alert alert--info">
            網路販售包裝食品，這些資訊在<strong>購買前</strong>就要揭露，商品頁會自動顯示。
            <br />
            留空的欄位會用「政策條款 → 食品標示預設值」的共用內容，
            不用每個商品都重打一次。
          </div>
          {FOOD_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`p-${f.key}`}>{f.label}</label>
              {f.textarea ? (
                <textarea id={`p-${f.key}`} className="input" name={f.key} rows={3}
                          value={form[f.key] || ''} onChange={change} />
              ) : (
                <input id={`p-${f.key}`} className="input" name={f.key}
                       value={form[f.key] || ''} onChange={change} />
              )}
              {f.hint && <div className="field__hint">{f.hint}</div>}
            </div>
          ))}
        </div>

        <div className="panel">
          <h2 className="panel__title">團購設定</h2>
          <label className="checkbox" style={{ marginBottom: 16 }}>
            <input type="checkbox" name="is_group_buy" checked={form.is_group_buy} onChange={change} />
            設為團購商品（會顯示在「團購專區」）
          </label>

          {form.is_group_buy && (
            <>
              <div className="field">
                <label htmlFor="group_buy_min_qty">成團數量</label>
                <input id="group_buy_min_qty" className="input" type="number" min="1" name="group_buy_min_qty"
                       value={form.group_buy_min_qty} onChange={change} />
              </div>
              <div className="field">
                <label htmlFor="group_buy_note">團購說明</label>
                <textarea id="group_buy_note" className="textarea" name="group_buy_note"
                          style={{ minHeight: 80 }} value={form.group_buy_note} onChange={change}
                          placeholder="例：6 瓶為一組，下單即成團，約 3-5 個工作天出貨。" />
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <h2 className="panel__title">顯示設定</h2>
          <div className="stack-sm">
            <label className="checkbox">
              <input type="checkbox" name="is_featured" checked={form.is_featured} onChange={change} />
              首頁精選（顯示在首頁「精選蜂蜜」區塊）
            </label>
            <label className="checkbox">
              <input type="checkbox" name="is_active" checked={form.is_active} onChange={change} />
              上架中（取消勾選則前台不顯示）
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
          <button type="submit" className="btn btn--primary" disabled={saving}>
            {saving ? '儲存中…' : isEdit ? '儲存變更' : '建立商品'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => navigate('/admin/products')}>取消</button>
        </div>
      </form>
    </>
  )
}
