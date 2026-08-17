import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const EditModeContext = createContext(null)
const KEY = 'honey_edit_mode'

/**
 * 就地編輯模式（只有工作人員看得到）。
 *
 * 打開之後，前台每一塊「後台可以改的東西」會浮出虛線框，
 * 點下去會問你要不要修改，按了就直接跳到後台對應的頁面與欄位。
 *
 * 為什麼不做「直接在前台改字存檔」：
 * 那需要在每個地方都放表單、處理驗證與權限，而且改一個字就送一次 API，
 * 很容易改到一半忘記存。現在的做法是「帶你到正確的地方」，
 * 真正的儲存還是走後台那一份已經有驗證與提示的表單，不會有兩套邏輯。
 */
export function EditModeProvider({ children }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(KEY) === '1')

  useEffect(() => {
    localStorage.setItem(KEY, enabled ? '1' : '0')
    // 用 class 掛在 body 上，CSS 才能一次點亮所有 [data-edit] 區塊，
    // 不必在每個元件裡判斷模式
    document.body.classList.toggle('edit-mode', enabled)
    return () => document.body.classList.remove('edit-mode')
  }, [enabled])

  const toggle = useCallback(() => setEnabled((v) => !v), [])
  const value = useMemo(() => ({ enabled, setEnabled, toggle }), [enabled, toggle])

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>
}

export function useEditMode() {
  return useContext(EditModeContext) || { enabled: false, setEnabled: () => {}, toggle: () => {} }
}

// editable() 與 adminLink() 是純函式，放在 lib/editTargets.js 才能用 node 直接測。
// 這裡轉出去，各頁面 import 的路徑不必改。
export { adminLink, editable } from '../lib/editTargets'
