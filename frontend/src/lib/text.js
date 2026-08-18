/**
 * 前台顯示文字的清理。
 *
 * 示範資料裡帶了一些「給後台使用者看的說明」，例如
 * 「（這段文字可於後台「故事管理」自行修改）」。
 * 那些字現在存在資料庫裡，客人看得到 —— 一句自己人的備忘出現在品牌故事最後，
 * 會讓整個網站看起來像沒做完。
 *
 * 正解當然是到後台把示範文字改掉，但在那之前不該讓客人看到，
 * 所以顯示前先濾一次。工作人員在編輯模式下仍會看到原文（在後台編輯時）。
 */

/** 括號裡帶有「可於後台…修改」這類字樣的整段註記。 */
const EDITOR_NOTE = /[（(][^（()）]{0,60}(可於後台|請於後台|於後台|後台[^（()）]{0,10}自行修改)[^（()）]{0,60}[)）]/g

/** 拿掉給後台使用者看的說明文字。 */
export function stripEditorNotes(text) {
  if (!text || typeof text !== 'string') return text
  return text.replace(EDITOR_NOTE, '').replace(/[ \t]+\n/g, '\n').trim()
}

/** 這段文字看起來是還沒填的示範內容嗎（用來決定要不要整段隱藏）。 */
export function isPlaceholderText(text) {
  if (!text || typeof text !== 'string') return true
  return stripEditorNotes(text).length === 0
}
