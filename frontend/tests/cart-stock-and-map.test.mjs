/**
 * 購物車庫存上限與地圖網址的測試。
 *
 * 這兩段都是純邏輯，不需要瀏覽器就能測。執行方式：
 *     cd frontend
 *     node src/test-cart-stock.mjs
 *
 * 為什麼要測：庫存超賣的代價是真的要跟客人道歉，
 * 而地圖網址的分支多到用眼睛看不完（座標／分享網址／iframe／純地址）。
 */

import { addressQuery, buildMapSrc, directionsUrl, mapPoint } from '../src/lib/maps.js'

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

// ---------------------------------------------------------------- 購物車庫存

// 把 CartContext 的核心規則抽出來重寫一份，行為必須一致。
const limitOf = (item) =>
  item?.stock === null || item?.stock === undefined ? Infinity : Math.max(0, Number(item.stock))

function add(items, product, quantity = 1) {
  const limit = limitOf(product)
  const want = Math.max(1, Math.floor(Number(quantity) || 1))
  const found = items.find((i) => i.id === product.id)
  const already = found ? found.quantity : 0
  const room = Math.max(0, limit - already)
  const added = Math.min(want, room)

  if (added <= 0) return { items, added: 0, capped: true, limit }
  const next = found
    ? items.map((i) => (i.id === product.id ? { ...i, quantity: already + added } : i))
    : [...items, { id: product.id, name: product.name, stock: product.stock, quantity: added }]
  return { items: next, added, capped: added < want, limit }
}

function updateQty(items, id, quantity) {
  return items.map((i) => {
    if (i.id !== id) return i
    const limit = limitOf(i)
    const wanted = Math.max(1, Math.floor(Number(quantity) || 1))
    return { ...i, quantity: Math.min(wanted, Math.max(1, limit)) }
  })
}

function testAdd() {
  console.log('\n[加入購物車不可超過庫存]')
  const p = { id: 1, name: '龍眼蜜', stock: 5 }

  let cart = []
  ;({ items: cart } = add(cart, p, 3))
  check('第一次加 3 組', cart[0].quantity === 3, String(cart[0].quantity))

  let r = add(cart, p, 3)
  cart = r.items
  check('再加 3 組只會加到 5', cart[0].quantity === 5, String(cart[0].quantity))
  check('有回報被壓到上限', r.capped === true)
  check('實際只加了 2 組', r.added === 2, String(r.added))

  r = add(cart, p, 1)
  check('滿了之後加不進去', r.added === 0)
  check('數量沒有變成 6', r.items[0].quantity === 5, String(r.items[0].quantity))

  // 一次就想加超過庫存
  r = add([], p, 99)
  check('一次加 99 組會被壓到 5', r.items[0].quantity === 5, String(r.items[0].quantity))

  // 沒有庫存
  r = add([], { id: 2, name: '售完', stock: 0 }, 1)
  check('庫存 0 加不進去', r.items.length === 0)

  // 沒有庫存管理
  r = add([], { id: 3, name: '無限', stock: null }, 999)
  check('stock 為 null 不限制', r.items[0].quantity === 999, String(r.items[0].quantity))

  // 髒資料
  for (const bad of [0, -5, 1.7, NaN, undefined, 'abc']) {
    r = add([], p, bad)
    const q = r.items[0]?.quantity
    check(`數量「${String(bad)}」會被修正成合法值`, q >= 1 && q <= 5, String(q))
  }
}

function testUpdateQty() {
  console.log('\n[修改數量不可超過庫存]')
  const cart = [{ id: 1, name: '龍眼蜜', stock: 5, quantity: 2 }]

  check('改成 4 沒問題', updateQty(cart, 1, 4)[0].quantity === 4)
  check('改成 5 剛好', updateQty(cart, 1, 5)[0].quantity === 5)
  check('改成 6 會被壓到 5', updateQty(cart, 1, 6)[0].quantity === 5)
  check('改成 999 會被壓到 5', updateQty(cart, 1, 999)[0].quantity === 5)
  check('改成 0 會被拉回 1', updateQty(cart, 1, 0)[0].quantity === 1)
  check('改成 -3 會被拉回 1', updateQty(cart, 1, -3)[0].quantity === 1)
  check('空字串會被拉回 1', updateQty(cart, 1, '')[0].quantity === 1)
  check('非數字會被拉回 1', updateQty(cart, 1, 'abc')[0].quantity === 1)
  check('小數會取整', updateQty(cart, 1, 3.9)[0].quantity === 3)

  const noStock = [{ id: 1, stock: null, quantity: 1 }]
  check('沒有庫存管理時不限制', updateQty(noStock, 1, 500)[0].quantity === 500)

  const soldOut = [{ id: 1, stock: 0, quantity: 1 }]
  check('庫存 0 至少留 1（會由畫面提示移除）', updateQty(soldOut, 1, 3)[0].quantity === 1)
}

function testSyncStock() {
  console.log('\n[進購物車時用最新庫存校正]')

  function syncStock(items, products) {
    const byId = new Map(products.map((p) => [p.id, p]))
    const notices = []
    const next = []
    for (const item of items) {
      const fresh = byId.get(item.id)
      if (!fresh || !fresh.is_active) { notices.push(`${item.name} 已下架`); continue }
      const limit = limitOf(fresh)
      if (limit === 0) { notices.push(`${item.name} 已售完`); continue }
      const quantity = Math.min(item.quantity, limit)
      if (quantity < item.quantity) notices.push(`${item.name} 數量已調整`)
      if (Number(fresh.price) !== item.price) notices.push(`${item.name} 售價已更新`)
      next.push({ ...item, price: Number(fresh.price), stock: fresh.stock, quantity })
    }
    return { items: next, notices }
  }

  const cart = [
    { id: 1, name: '龍眼蜜', price: 600, stock: 10, quantity: 8 },
    { id: 2, name: '百花蜜', price: 500, stock: 10, quantity: 3 },
    { id: 3, name: '下架品', price: 400, stock: 10, quantity: 1 },
    { id: 4, name: '售完品', price: 300, stock: 10, quantity: 2 },
  ]
  const products = [
    { id: 1, price: 600, stock: 4, is_active: true },     // 庫存變少
    { id: 2, price: 550, stock: 10, is_active: true },    // 漲價
    { id: 4, price: 300, stock: 0, is_active: true },     // 售完
    // id 3 不在清單裡 = 已下架
  ]

  const { items, notices } = syncStock(cart, products)
  check('下架的被移除', !items.find((i) => i.id === 3))
  check('售完的被移除', !items.find((i) => i.id === 4))
  check('剩下兩項', items.length === 2, String(items.length))
  check('超過庫存的被壓到 4', items.find((i) => i.id === 1).quantity === 4)
  check('沒超過的不動', items.find((i) => i.id === 2).quantity === 3)
  check('價格跟著更新', items.find((i) => i.id === 2).price === 550)
  check('四項變動都有提示', notices.length === 4, `${notices.length} 則：${notices.join('／')}`)

  const clean = syncStock(
    [{ id: 1, name: '龍眼蜜', price: 600, stock: 10, quantity: 2 }],
    [{ id: 1, price: 600, stock: 10, is_active: true }],
  )
  check('都沒變就不打擾買家', clean.notices.length === 0, clean.notices.join('／'))
}

function testCheckoutGuard() {
  console.log('\n[結帳前的最後一道檢查]')
  const hasIssue = (items) => items.some((i) => i.quantity > limitOf(i))

  check('數量剛好不算問題', !hasIssue([{ stock: 5, quantity: 5 }]))
  check('超過就是問題', hasIssue([{ stock: 5, quantity: 6 }]))
  check('多項中有一項超過就算', hasIssue([{ stock: 5, quantity: 1 }, { stock: 2, quantity: 3 }]))
  check('沒有庫存管理不算問題', !hasIssue([{ stock: null, quantity: 999 }]))
  check('空車不算問題', !hasIssue([]))
}

// ---------------------------------------------------------------- 地圖網址

function testMap() {
  console.log('\n[地圖網址]')
  const base = { shop_name: '皇龍蜂蜜', contact_address: '基隆市七堵區華新一路89-6號' }

  // 門牌 -6 的處理
  const q = addressQuery(base)
  check('89-6號 轉成 89之6號', q.includes('89之6號'), q)
  check('查詢帶上店名', q.startsWith('皇龍蜂蜜'), q)
  check('沒有地址就沒有查詢字串', addressQuery({ shop_name: '皇龍蜂蜜' }) === '')
  check(
    '多個門牌都會轉',
    addressQuery({ contact_address: '中山路1-2號與民生路3-4號' }) === '中山路1之2號與民生路3之4號',
    addressQuery({ contact_address: '中山路1-2號與民生路3-4號' }),
  )
  check(
    '不是門牌的減號不動',
    addressQuery({ contact_address: '基隆市七堵區華新一路89號 02-2456-7890' }).includes('02-2456-7890'),
  )

  // 座標最精準
  for (const input of ['25.105821, 121.712378', '25.105821,121.712378', '  25.105821 , 121.712378  ']) {
    const src = buildMapSrc({ ...base, map_embed_url: input })
    check(`座標「${input.trim()}」可用`, src === 'https://maps.google.com/maps?q=25.105821,121.712378&z=18&output=embed', src)
  }
  check(
    '全形逗號的座標也可用',
    buildMapSrc({ ...base, map_embed_url: '25.105821，121.712378' }).includes('q=25.105821,121.712378'),
  )

  // 各種網址
  const cases = [
    ['整段 iframe', '<iframe src="https://www.google.com/maps/embed?pb=abc" width="600"></iframe>', 'maps/embed?pb=abc'],
    ['已是 embed 網址', 'https://www.google.com/maps/embed?pb=xyz', 'maps/embed?pb=xyz'],
    ['帶 @座標的分享網址', 'https://www.google.com/maps/place/x/@25.1058,121.7123,17z', 'q=25.1058,121.7123'],
    ['/place/ 網址', 'https://www.google.com/maps/place/%E7%9A%87%E9%BE%8D%E8%9C%82%E8%9C%9C', 'output=embed'],
    ['?q= 網址', 'https://maps.google.com/?q=25.1,121.7', 'q=25.1,121.7'],
    ['一段純地址文字', '基隆市七堵區華新一路89-6號', 'output=embed'],
  ]
  for (const [name, input, expect] of cases) {
    const src = buildMapSrc({ ...base, map_embed_url: input })
    check(name, src.includes(expect), src || '(空)')
  }

  // 短網址無法在瀏覽器展開，要退回用地址
  const short = buildMapSrc({ ...base, map_embed_url: 'https://maps.app.goo.gl/abcdef' })
  check('短網址退回用地址', short.includes('89%E4%B9%8B6') || short.includes(encodeURIComponent('89之6號')), short)

  // 留空
  check('留空就用地址', buildMapSrc(base).includes('output=embed'))
  check('地址也沒填就不顯示地圖', buildMapSrc({}) === '')

  // 所有輸出都必須可嵌入，不然 Google 會拒絕連線
  const all = [
    buildMapSrc(base),
    buildMapSrc({ ...base, map_embed_url: '25.1,121.7' }),
    buildMapSrc({ ...base, map_embed_url: 'https://www.google.com/maps/place/x/@25.1,121.7,17z' }),
  ]
  check(
    '產出的網址都是可嵌入形式',
    all.every((s) => /\/maps\/embed/.test(s) || /output=embed/.test(s)),
    all.join(' | '),
  )
}

function testDirections() {
  console.log('\n[規劃路線的目的地]')
  const base = { shop_name: '皇龍蜂蜜', contact_address: '基隆市七堵區華新一路89-6號' }

  // 沒填座標：只能用地址，Google 會自己猜（這正是會導到 89 號的原因）
  const byAddress = directionsUrl(base)
  check('沒座標時用地址', byAddress.includes('dir/?api=1&destination='), byAddress)
  check('地址有轉成「之」的寫法', byAddress.includes(encodeURIComponent('89之6號')), byAddress)

  // 填了座標：一定要用座標，不能再讓 Google 猜
  const withPoint = { ...base, map_embed_url: '25.098406, 121.665791' }
  const url = directionsUrl(withPoint)
  check('有座標時改用座標', url.includes('25.098406%2C121.665791') || url.includes('25.098406,121.665791'), url)
  check('有座標時不再送地址', !url.includes('%E8%8F%AF%E6%96%B0'), url)
  check('仍是 Google 導航網址', url.startsWith('https://www.google.com/maps/dir/?api=1&destination='), url)

  // 各種能抓到座標的來源
  const sources = [
    ['純座標', '25.098406, 121.665791'],
    ['沒有空格', '25.098406,121.665791'],
    ['全形逗號', '25.098406，121.665791'],
    ['分享網址的 @座標', 'https://www.google.com/maps/place/x/@25.098406,121.665791,18z'],
    ['?q= 座標', 'https://maps.google.com/?q=25.098406,121.665791'],
    ['整段 iframe', '<iframe src="https://maps.google.com/maps?q=25.098406,121.665791&output=embed"></iframe>'],
  ]
  for (const [name, value] of sources) {
    const point = mapPoint({ ...base, map_embed_url: value })
    check(`${name} 抓得出座標`, point === '25.098406,121.665791', String(point))
  }

  // 抓不到座標的情況要回 null，不能亂猜
  for (const [name, value] of [
    ['留空', ''],
    ['短網址', 'https://maps.app.goo.gl/abcdef'],
    ['一段地址文字', '基隆市七堵區華新一路89-6號'],
    ['沒有座標的 place 網址', 'https://www.google.com/maps/place/%E7%9A%87%E9%BE%8D'],
  ]) {
    check(`${name} 回 null`, mapPoint({ ...base, map_embed_url: value }) === null,
          String(mapPoint({ ...base, map_embed_url: value })))
  }

  // 地圖與導航要指到同一個點，不然「地圖對了、導航錯了」更難察覺
  const embed = buildMapSrc(withPoint)
  check('地圖與導航用同一組座標',
        embed.includes('25.098406,121.665791') && url.includes('25.098406'),
        `${embed} | ${url}`)

  // 什麼都沒有時不要產生半殘的網址
  check('完全沒資料時回空字串', directionsUrl({}) === '', directionsUrl({}))
}

console.log('='.repeat(60))
console.log('購物車庫存與地圖網址測試')
console.log('='.repeat(60))
testAdd()
testUpdateQty()
testSyncStock()
testCheckoutGuard()
testMap()
testDirections()

console.log('\n' + '='.repeat(60))
if (failures.length) {
  console.log(`${passed} 項通過，${failures.length} 項失敗：`)
  failures.forEach((f) => console.log(`  - ${f}`))
  process.exit(1)
}
console.log(`全部 ${passed} 項測試通過`)
