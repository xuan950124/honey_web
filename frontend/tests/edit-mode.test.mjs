/**
 * 編輯模式的純邏輯測試（路徑對照、可編輯標記、略過清單）。
 *
 *     cd frontend
 *     node tests/edit-mode.test.mjs
 *
 * 為什麼要測：路徑比對表是「先比到的贏」，順序寫錯就會出現
 * 點商品頁卻叫你去改首頁這種蠢事，而且用眼睛很難看出來。
 */
import fs from 'node:fs'
import {
  PAGE_TARGETS, SKIP_SELECTOR, adminLink, editable, pageTarget,
} from '../src/lib/editTargets.js'

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

function testPageTargets() {
  console.log('\n[每頁的預設編輯目標]')

  const cases = [
    ['/', '首頁', '/admin/settings'],
    ['/products', '商品列表', '/admin/products'],
    ['/products/', '商品列表', '/admin/products'],
    ['/products/12', '商品內容', '/admin/products'],
    ['/products/12345', '商品內容', '/admin/products'],
    ['/group-buy', '團購商品', '/admin/products'],
    ['/news', '新聞報導', '/admin/news'],
    ['/news/5', '新聞報導', '/admin/news'],
    ['/story', '品牌故事', '/admin/stories'],
    ['/contact', '聯絡資訊', '/admin/settings'],
    ['/cart', '運費與付款設定', '/admin/settings'],
    ['/order/20260817120000123', '訂單', '/admin/orders'],
    ['/member', '會員等級與折價券', '/admin/membership'],
  ]

  for (const [path, label, to] of cases) {
    const t = pageTarget(path)
    check(`${path} → ${label}`, t?.label === label, t ? t.label : '(沒有對應)')
    check(`${path} → ${to}`, t?.to === to, t ? t.to : '(沒有對應)')
  }

  // 商品詳細頁一定要比商品列表先比對到，順序寫反就會指錯地方
  const detailIdx = PAGE_TARGETS.findIndex((t) => t.label === '商品內容')
  const listIdx = PAGE_TARGETS.findIndex((t) => t.label === '商品列表')
  check('商品詳細頁排在商品列表之前', detailIdx < listIdx, `詳細 ${detailIdx} / 列表 ${listIdx}`)

  // 沒有對應的頁面要老實回 null，不要亂猜
  for (const path of ['/login', '/register', '/verify-email', '/reset-password', '/nope']) {
    check(`${path} 沒有對應（回 null）`, pageTarget(path) === null, String(pageTarget(path)?.label))
  }

  // 每一筆都要有 label 與 to，不然提示會顯示 undefined
  for (const t of PAGE_TARGETS) {
    check(`「${t.label}」設定完整`, Boolean(t.label && t.to && t.match instanceof RegExp))
    check(`「${t.label}」指向後台`, t.to.startsWith('/admin'), t.to)
  }
}

function testEditable() {
  console.log('\n[可編輯區塊的標記]')

  const full = editable('品牌標語', '/admin/settings', 'shop_slogan', '要短一點')
  check('有 data-edit', full['data-edit'] === '/admin/settings')
  check('有 data-edit-label', full['data-edit-label'] === '品牌標語')
  check('有 data-edit-focus', full['data-edit-focus'] === 'shop_slogan')
  check('有 data-edit-hint', full['data-edit-hint'] === '要短一點')

  const minimal = editable('新聞', '/admin/news')
  check('沒給 focus 就不要有那個屬性', !('data-edit-focus' in minimal), JSON.stringify(minimal))
  check('沒給 hint 就不要有那個屬性', !('data-edit-hint' in minimal), JSON.stringify(minimal))
  check('最少也要有兩個屬性', Object.keys(minimal).length === 2, String(Object.keys(minimal).length))

  // 傳 null / undefined / 空字串都不該產生空屬性
  for (const empty of [null, undefined, '']) {
    const r = editable('X', '/admin/news', empty, empty)
    check(`focus 為 ${JSON.stringify(empty)} 時不加屬性`, !('data-edit-focus' in r))
  }

  // 屬性名稱一律是 data-* 開頭，React 才不會噴警告
  check(
    '所有屬性都是 data-* 開頭',
    Object.keys(full).every((k) => k.startsWith('data-')),
    Object.keys(full).join(', '),
  )
}

function testAdminLink() {
  console.log('\n[後台連結]')
  check('沒有 focus 就是原路徑', adminLink('/admin/news') === '/admin/news')
  check('有 focus 會加參數', adminLink('/admin/settings', 'shop_name') === '/admin/settings?focus=shop_name')
  check(
    '中文與特殊字元會編碼',
    adminLink('/admin/settings', 'a b&c') === '/admin/settings?focus=a%20b%26c',
    adminLink('/admin/settings', 'a b&c'),
  )
  check('空字串視為沒有 focus', adminLink('/admin/news', '') === '/admin/news')
}

function testSkipSelector() {
  console.log('\n[編輯模式不攔的東西]')

  // 導覽是最重要的：攔了就走不到別的頁面
  for (const cls of ['.nav', '.drawer', '.hamburger', '.breadcrumb']) {
    check(`${cls} 在略過清單裡`, SKIP_SELECTOR.includes(cls))
  }
  // 自己的工具列不能攔自己
  for (const cls of ['.edit-fab', '.edit-bar', '.edit-pop']) {
    check(`${cls} 在略過清單裡`, SKIP_SELECTOR.includes(cls))
  }
  // 手機預覽也要能開
  check('.preview-fab 在略過清單裡', SKIP_SELECTOR.includes('.preview-fab'))
  // 各頁面可以自行標記
  check('支援 data-edit-skip', SKIP_SELECTOR.includes('[data-edit-skip]'))

  // 必須是合法的 CSS 選擇器（用逗號分隔且沒有空項）
  const parts = SKIP_SELECTOR.split(',').map((s) => s.trim())
  check('沒有空的選擇器', parts.every(Boolean), SKIP_SELECTOR)
  check('每一項都是 class 或屬性選擇器',
    parts.every((s) => s.startsWith('.') || s.startsWith('[')), parts.join(' | '))
}

function testSourceMarkup() {
  console.log('\n[實際頁面有標上可編輯區塊]')
  // 直接讀原始碼確認關鍵頁面真的有用 editable()，
  // 不然邏輯全對但沒人用到，功能等於不存在
  const files = {
    'components/Header.jsx': ['shop_name', 'shop_slogan'],
    'components/Footer.jsx': ['hero_desc', 'data-edit-skip'],
    'components/ProductCard.jsx': ['editable'],
    'pages/NewsDetail.jsx': ['editable'],
  }
  for (const [file, needles] of Object.entries(files)) {
    const src = fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    for (const needle of needles) {
      check(`${file} 有標上 ${needle}`, src.includes(needle))
    }
  }

  // 頁面的內容會被拆進 components/sections/，所以這幾項不綁檔名 ——
  // 綁了的話每次重構都要跟著改測試，而真正要確認的是
  // 「網站上還找得到這個可編輯標記」，不是「它住在哪個檔案」。
  const tree = readAll(new URL('../src/', import.meta.url))
  const anywhere = Object.values(tree).join('\n')
  for (const needle of ['hero_title', 'hero_image_url', 'map_embed_url', 'line_qr_url']) {
    check(`全站有標上 ${needle}`, anywhere.includes(needle))
  }
  for (const [label, kw] of [['品牌故事', '故事：'], ['新聞列表', '報導：']]) {
    check(`${label} 有標上 editable`,
          Object.values(tree).some((s) => s.includes(kw) && s.includes('editable')),
          '內容搬家了也要留著可編輯標記')
  }
}

/** 遞迴讀 src 下所有 .jsx / .js，回傳 { 相對路徑: 內容 }。 */
function readAll(dir, base = dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir)
    if (entry.isDirectory()) readAll(url, base, out)
    else if (/\.jsx?$/.test(entry.name)) {
      out[decodeURIComponent(url.pathname.slice(base.pathname.length))] =
        fs.readFileSync(url, 'utf8')
    }
  }
  return out
}

console.log('='.repeat(60))
console.log('編輯模式測試')
console.log('='.repeat(60))
testPageTargets()
testEditable()
testAdminLink()
testSkipSelector()
testSourceMarkup()

console.log('\n' + '='.repeat(60))
if (failures.length) {
  console.log(`${passed} 項通過，${failures.length} 項失敗：`)
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log(`全部 ${passed} 項測試通過`)
