import { useRef, useState } from 'react'
import { api } from '../api/client'
import Placeholder from './Placeholder'

/**
 * 工作人員上傳照片元件。
 * 上傳成功後回傳圖片網址（例如 /uploads/xxxx.jpg），由父層存進商品或新聞。
 */
export default function ImageUploader({ value, onChange, label = '照片', ratio = '1x1', hint }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setUploading(true)
    try {
      const res = await api.uploadImage(file)
      onChange(res.url)
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 16, alignItems: 'start' }}>
        <Placeholder src={value} ratio={ratio} hint={hint ?? '尚未上傳'} alt={label} />
        <div className="uploader">
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} disabled={uploading} />
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {uploading ? '上傳中…' : '支援 JPG / PNG / WEBP / GIF，單張最大 8MB'}
          </p>
          {value && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <code className="small" style={{ color: 'var(--honey-700)', wordBreak: 'break-all' }}>{value}</code>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange(null)}>
                移除照片
              </button>
            </div>
          )}
          {error && <div className="alert alert--error" style={{ marginTop: 10, marginBottom: 0 }}>{error}</div>}
        </div>
      </div>
      <div className="field__hint">
        也可以直接填入外部網址，或把圖片放到 frontend/public/images/ 後填 /images/檔名.jpg
      </div>
      <input
        className="input"
        style={{ marginTop: 8 }}
        placeholder="圖片網址（留空則前台顯示空白佔位）"
        value={value || ''}
        onChange={(e) => onChange(e.target.value || null)}
      />
    </div>
  )
}
