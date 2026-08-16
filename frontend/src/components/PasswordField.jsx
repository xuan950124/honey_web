import { useId, useState } from 'react'

/**
 * 密碼輸入欄，附「顯示密碼」勾選框。
 * 讓使用者能自己確認有沒有打錯，比要求輸入兩次更友善。
 */
export default function PasswordField({
  label = '密碼',
  name = 'password',
  value,
  onChange,
  required = false,
  autoComplete = 'current-password',
  hint,
  minLength,
  showToggle = true,
  toggleLabel = '顯示密碼',
}) {
  const [visible, setVisible] = useState(false)
  const id = useId()

  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      <input
        id={id}
        className="input"
        type={visible ? 'text' : 'password'}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
      />
      {hint && <div className="field__hint">{hint}</div>}
      {showToggle && (
        <label className="checkbox" style={{ marginTop: 9 }}>
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => setVisible(e.target.checked)}
          />
          <span className="small">{toggleLabel}</span>
        </label>
      )}
    </div>
  )
}
