/**
 * 多欄格線裡的間距規則。
 *
 * ## 為什麼要有這一份
 *
 * 同一個 bug 已經出現兩次，都是「照上下堆疊寫的間距規則，被放進多欄格線」：
 *
 * 1. `.panel + .panel { margin-top: 22px }` —— 聯絡我們的訂購須知四格，
 *    同一列的第 2 格被往下推 22px，四格高度看起來不齊
 * 2. `.news-item:first-child { padding-top: 0 }` —— 首頁「最新消息與報導」是兩欄，
 *    「第一則」不等於「第一列」，右邊那則還留著 26px 上內距
 *
 * 兩種寫法在單欄時完全正確，一放進 grid 就錯 —— 而且錯得很細微，
 * 不會壞掉、只是「看起來怪怪的」，很容易一直留著沒人發現。
 * 所以這裡除了鎖住已修好的兩處，還會掃描有沒有**新增**同類型的規則
 * 卻忘了處理格線。
 *
 * 執行：
 *     cd frontend
 *     node tests/layout-css.test.mjs
 */
import fs from 'node:fs'

const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

let passed = 0
const failures = []

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ok   ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/** 把註解拿掉再比對，不然註解裡提到的選擇器會被當成真的規則。 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------- 已修好的兩處

function testKnownFixes() {
  console.log('\n[已修好的兩處不能被改回去]')

  check('.panel + .panel 在格線裡被歸零',
        /\.grid\s*>\s*\.panel\s*\+\s*\.panel\s*\{[^}]*margin-top:\s*0/.test(code),
        '少了這一條，訂購須知那四格會再度高度不齊')

  check('兩欄新聞的第一列兩則都去掉上內距',
        /\.grid--news\s+\.news-item:nth-child\(-n\s*\+\s*2\)\s*\{[^}]*padding-top:\s*0/.test(code),
        '少了這一條，首頁最新消息右邊那則會比左邊低一截')

  // 手機收成一欄之後「第一列」只剩第一則，第二則的上內距要還回來
  const mobile = code.match(/@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.grid--news[\s\S]*?\n\}/)
  check('手機版把第二則的上內距還回來',
        Boolean(mobile) && /\.news-item:nth-child\(2\)\s*\{[^}]*padding-top:\s*26px/.test(mobile[0]),
        '不還回來的話手機上前兩則會黏在一起')
}

// ---------------------------------------------------------------- 掃描新的同類規則

/**
 * 這些 class 確定只用在單欄的地方，照上下堆疊寫間距是對的。
 *
 * 要新增請寫清楚它為什麼不會出現在多欄格線裡 —— 這個清單是給人看的，
 * 不是給程式繞過檢查用的。加進來之前先搜一下 JSX：
 * 只要它有機會變成 .grid 的直接子元素，就不該放進這裡。
 */
const SINGLE_COLUMN_OK = {
  'policy__h2': '政策條款的內文標題，永遠是單欄長文',
  'drawer__section': '手機版漢堡選單的分段，抽屜本身就是一條直的',
}

function testNoNewOffenders() {
  console.log('\n[沒有新的「單欄寫法」漏進多欄格線]')

  // 1) .X + .X { margin-top } —— 相鄰兄弟的上外距
  const adjacent = [...code.matchAll(/\.([\w-]+)\s*\+\s*\.\1\s*\{([^}]*)\}/g)]
    .filter(([, , body]) => /margin-top\s*:\s*(?!0)/.test(body))
    .map(([, cls]) => cls)

  for (const cls of new Set(adjacent)) {
    if (SINGLE_COLUMN_OK[cls]) {
      check(`.${cls} + .${cls} 已確認只用在單欄`, true)
      continue
    }
    const overridden = new RegExp(
      `\\.grid[\\w-]*\\s*>?\\s*\\.${cls}\\s*\\+\\s*\\.${cls}\\s*\\{[^}]*margin-top:\\s*0`,
    ).test(code)
    check(`.${cls} + .${cls} 有處理格線的情況`, overridden,
          `.${cls} 若被放進 .grid，同一列的第 2 塊之後都會被往下推。`
          + `請加一條 .grid > .${cls} + .${cls} { margin-top: 0 }`)
  }

  // 2) .X:first-child { padding-top: 0 } —— 用「第一個」代替「第一列」
  const firstChild = [...code.matchAll(/\.([\w-]+):first-child\s*\{([^}]*)\}/g)]
    .filter(([, , body]) => /(padding|margin)-top\s*:\s*0/.test(body))
    .map(([, cls]) => cls)

  for (const cls of new Set(firstChild)) {
    if (SINGLE_COLUMN_OK[cls]) {
      check(`.${cls}:first-child 已確認只用在單欄`, true)
      continue
    }
    const overridden = new RegExp(`\\.grid[\\w-]*\\s+\\.${cls}:nth-child`).test(code)
    check(`.${cls}:first-child 有處理多欄的情況`, overridden,
          `多欄時「第一個」不等於「第一列」，右邊那些會多出上內距。`
          + `請加 .grid--xxx .${cls}:nth-child(-n + 欄數) { padding-top: 0 }，`
          + `或把它加進 SINGLE_COLUMN_OK 並寫明理由`)
  }

  check('掃描確實有找到規則（避免正則寫壞卻默默全過）',
        adjacent.length + firstChild.length > 0,
        '一條都沒掃到通常代表正則失效，不是真的沒有規則')
}

// ---------------------------------------------------------------- 格線本身

function testGridBasics() {
  console.log('\n[格線的基本設定]')
  check('.grid 有 gap（間距靠 gap 不靠 margin）',
        /\.grid\s*\{[^}]*gap:/.test(code),
        '有 gap 才不需要在子元素上加 margin，也才不會有這一整類 bug')

  for (const n of [2, 3, 4]) {
    check(`.grid--${n} 是 ${n} 欄`,
          new RegExp(`\\.grid--${n}\\s*\\{[^}]*repeat\\(${n},`).test(code))
  }
  check('.grid--news 是兩欄', /\.grid--news\s*\{[^}]*repeat\(2,/.test(code))
}

console.log('='.repeat(60))
console.log('版面間距測試')
console.log('='.repeat(60))
testKnownFixes()
testNoNewOffenders()
testGridBasics()

console.log('\n' + '='.repeat(60))
if (failures.length) {
  console.log(`${passed} 項通過，${failures.length} 項失敗：`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
console.log(`全部 ${passed} 項測試通過`)
