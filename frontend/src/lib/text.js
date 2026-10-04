import { createElement } from 'react'

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

/**
 * 商品名稱裡「數字＋單位」不要被拆成兩行。
 *
 * 「4 入組」「200g x 2入」「700g 經典大瓶裝」這種寫法中間有半形空白，瀏覽器會把它當成可以換行的地方，
 * 結果變成行尾「…紅淡蜜 4」、下一行開頭「入組（700g…」，或括號裡的規格被拆成「（700g」｜「經典大瓶裝）」。
 * 把這幾個空白換成不換行空白（U+00A0），畫面上看起來一樣，但不會從中間斷開
 * （括號前面仍然可以換行，所以整個括號會一起換到下一行）。
 */
export function tidyBreaks(text) {
  if (!text || typeof text !== 'string') return text
  return text
    .replace(/(\d[a-zA-Z]{0,2})\s+(?=[\u3400-\u9fff])/g, '$1\u00a0')
    .replace(/\s+([x×＊*])\s+(?=\d)/g, '\u00a0$1\u00a0')
    // 「2026 K STAR」這種英數專有名詞也不要從中間斷（報導標題曾經斷成行尾「2026 K」、下一行「STAR」）。
    // 只綁「兩邊都是英數、而且有一邊只有一兩個字」的空白，一般的英文句子照常換行。
    // 不用 lookbehind：舊版 iPhone Safari 不支援，整個網站的程式會載入失敗。
    .replace(/([A-Za-z0-9]) (?=[A-Za-z0-9]{1,2}(?![A-Za-z0-9]))/g, '$1\u00a0')
    .replace(/(^|[^A-Za-z0-9'’])([A-Za-z0-9]{1,2}) (?=[A-Za-z0-9])/g, '$1$2\u00a0')   // Huang's 的 s 不算
}

/**
 * 報導內文（後台的純文字）切成一段一段，認出小標題。
 *
 * 店家貼的報導都是這種寫法：段落之間空一行；一段的第一行很短、沒有句尾標點，
 * 下面又接著一整段文字，那一行就是小標（「品牌及包裝設計輔導」「📍 參訪資訊」）。
 * 整行用【】括起來的是報導自己的標題；最後一段整行用（）括起來的是出處說明。
 * 認不出來的一律當一般段落，字一個都不會少。
 */
const SENTENCE_END = /[。！？!?…，,、；;：:]$/
const SUBHEAD_MAX = 24   // 小標最多幾個字（emoji 算一個）
const PARA_MIN = 20      // 小標下面至少要有這麼多字，才不會把三行的短訊息誤認成小標

// 標題頭尾的表情符號（含膚色、性別、變體選擇字元與零寬連接字）
const EDGE_EMOJI = /^[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+|[\s\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+$/gu

/**
 * 小標與報導標題拿掉頭尾的表情符號（「📍 參訪資訊」→「參訪資訊」，【】裡面的也拿掉）。
 * 排成明體粗字的小標時，開頭的 📍🌼 會變成一整排圖示，品牌規範不用表情符號當圖示。
 * 後台存的文字不動，內文段落裡的表情符號也照樣顯示。
 */
function stripEdgeEmoji(line) {
  const bracket = line.match(/^【(.*)】$/)
  if (bracket) {
    const inner = bracket[1].replace(EDGE_EMOJI, '')
    return inner ? `【${inner}】` : ''
  }
  return line.replace(EDGE_EMOJI, '')
}

export function articleBlocks(text) {
  if (!text || typeof text !== 'string') return []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t\u3000]*\n/)
    .map((b) => b.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length)

  return blocks.flatMap((lines, i) => {
    const [first, ...rest] = lines
    if (!rest.length && /^【.*】$/.test(first)) {
      const headline = stripEdgeEmoji(first)
      return [headline ? { type: 'headline', text: headline } : { type: 'para', text: first }]
    }
    if (!rest.length && i === blocks.length - 1 && /^[（(].*[)）]$/.test(first)) return [{ type: 'note', text: first }]
    const body = rest.join('\n')
    const subhead = stripEdgeEmoji(first)
    if (rest.length && subhead && [...first].length <= SUBHEAD_MAX && !SENTENCE_END.test(first) && [...body].length >= PARA_MIN) {
      return [{ type: 'subhead', text: subhead }, { type: 'para', text: body }]
    }
    return [{ type: 'para', text: lines.join('\n') }]
  })
}

/**
 * 寫死在程式裡的長句，用「|」標出可以換行的地方（畫面上看不到這個符號）。
 *
 * 全站用 word-break: keep-all，中文只在標點與空白處換行，詞不會被切開；
 * 但一整串沒有標點的長句放進窄欄時，就只能硬切，常常切在詞中間（「即｜可」）。
 * 在詞與詞之間放一個 <wbr>，瀏覽器就會優先從那裡換行。
 */
export function softBreaks(text) {
  if (!text || typeof text !== 'string' || !text.includes('|')) return text
  return text.split('|').flatMap((part, i) => (i ? [createElement('wbr', { key: i }), part] : [part]))
}

// 中文斷詞器。舊瀏覽器沒有的話就什麼都不做（照 keep-all 的規則換行）
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('zh-Hant', { granularity: 'word' })
  : null
const CJK_START = /^[\u3400-\u9fff\uf900-\ufaff]/
const CJK_END = /[\u3400-\u9fff\uf900-\ufaff]$/
const CJK_ALL = /[\u3400-\u9fff\uf900-\ufaff]/g

/**
 * 從後台來的中文長句（商品副標、報導摘要、常見問題…），太長的那幾段在詞與詞之間放 <wbr>。
 *
 * 全站用 word-break: keep-all，中文只在標點與空白處換行，一般句子會一個分句一個分句地換行，
 * 很好讀。但一段十幾二十個字沒有標點的長句放進窄欄時，瀏覽器就只能硬切，
 * 常切在詞中間（「系｜統」）。
 *
 * 所以只有「標點之間超過 12 個字」的長段落才加換行點（手機上窄欄一行大約 14 個字，
 * 超過 12 個字的分句就有可能塞不下，最後的標點被擠到下一行），而且用瀏覽器內建的斷詞器
 * 找詞的邊界；短分句維持原樣（斷詞器不認得「封蓋」這種詞，給它換行點反而會切錯）。
 * 每一行最後剩不到 3 個字時不給換行點，避免最後一行只剩一個字。
 * 畫面上看不出任何差別，複製文字也不會多出東西。
 */
const LONG_RUN = 12

export function wordBreaks(text) {
  if (!segmenter || !text || typeof text !== 'string') return text
  const segs = [...segmenter.segment(text)]
  const cjkCount = (str) => (str.match(CJK_ALL) || []).length

  // rest[i]：從第 i 段到這一行結束（換行或全文結尾）還有幾個中文字
  const rest = new Array(segs.length).fill(0)
  let count = 0
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    if (segs[i].segment.includes('\n')) count = 0
    count += cjkCount(segs[i].segment)
    rest[i] = count
  }

  // run[i]：第 i 段所在的「兩個標點／空白之間」那一段有幾個中文字；runId[i]：是第幾段
  const run = new Array(segs.length).fill(0)
  const runId = new Array(segs.length).fill(-1)
  for (let i = 0, id = 0; i < segs.length;) {
    if (!segs[i].isWordLike) { i += 1; continue }
    let j = i
    let n = 0
    while (j < segs.length && segs[j].isWordLike) { n += cjkCount(segs[j].segment); j += 1 }
    for (let k = i; k < j; k += 1) { run[k] = n; runId[k] = id }
    id += 1
    i = j
  }

  // 單字的詞（「全」「的」「了」）跟前後黏在一起，只在兩個兩字以上的詞之間給換行點，
  // 避免「全｜都是」這種切法。
  // 但如果一整段長句裡完全找不到「兩個詞之間」的位置（例如「全都是從無數次的失敗與實作中累積而成」
  // 被切成一堆單字的詞），就退一步：只要有一邊是兩個字以上的詞就可以換 ——
  // 不然這一段只能整段硬塞，塞不下時最後的「。」會被擠到下一行開頭。
  const strict = new Set()
  const relaxed = new Set()
  const runHasStrict = new Set()
  let prev = ''
  segs.forEach(({ segment }, i) => {
    if (i > 0 && run[i] > LONG_RUN && rest[i] >= 3 && CJK_END.test(prev) && CJK_START.test(segment)) {
      if (prev.length >= 2 && segment.length >= 2) {
        strict.add(i)
        runHasStrict.add(runId[i])
      } else if (prev.length >= 2 || segment.length >= 2) {
        relaxed.add(i)
      }
    }
    prev = segment
  })
  relaxed.forEach((i) => { if (!runHasStrict.has(runId[i])) strict.add(i) })

  // 全形的左括號前面也給一個換行點：商品名稱的「（700g 經典大瓶裝）」要能整段換到下一行。
  // 全站的 keep-all 會把「組（」當成連在一起的字，括號前面原本不能換行，
  // 窄欄放不下時整串只能硬擠，最後超出卡片。
  const openParen = (segment, i) => i > 0 && /^[（【「]/.test(segment) && CJK_END.test(segs[i - 1].segment)

  const out = []
  let buf = ''
  segs.forEach(({ segment }, i) => {
    if ((strict.has(i) || openParen(segment, i)) && buf) {
      out.push(buf, createElement('wbr', { key: out.length }))
      buf = ''
    }
    buf += segment
  })
  if (buf) out.push(buf)
  return out.length === 1 ? out[0] : out
}

/** 後台來的一段文字：數字與單位黏在一起、詞與詞之間可以換行。 */
export const prose = (text) => wordBreaks(tidyBreaks(text))
