import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, getToken } from '../api/client'
import { useAuth } from './AuthContext'

const CartContext = createContext(null)
const CART_KEY = 'honey_cart'
// 變動後隔多久才送到伺服器。連按加號時不要每一下都打一次 API
const SYNC_DELAY = 800

/**
 * 購物車。數量一律受庫存上限限制。
 *
 * 為什麼庫存要存在購物車項目裡：購物車放在 localStorage，會跨天存在。
 * 買家可能今天加入、三天後才結帳，那時庫存早就變了。
 * 所以除了加入時擋，進到購物車頁還會再跟後端要一次最新庫存重新校正（syncStock）。
 * 後端建立訂單時也會再檢查一次 —— 前端的限制只是為了不讓買家白填一整頁資料。
 */

/** 商品的可下單上限。沒有庫存管理（stock 為 null）就不限制。 */
const limitOf = (item) => (item?.stock === null || item?.stock === undefined ? Infinity : Math.max(0, Number(item.stock)))

export function CartProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  const [toast, setToast] = useState('')

  // 剛從伺服器拉下來的那一次不要再推回去（會變成無意義的來回）
  const skipNextPush = useRef(false)
  const syncTimer = useRef(null)
  const lastUserId = useRef(null)

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  }, [items])

  /** 把伺服器回傳的購物車轉成前端用的格式。 */
  const fromServer = useCallback((rows) => (rows || []).map((r) => ({
    id: r.id,
    name: r.name,
    price: Number(r.price),
    spec: r.spec || '',
    image_url: r.image_url || null,
    stock: r.stock,
    quantity: r.quantity,
  })), [])

  /**
   * 登入時把本機的購物車併進伺服器那一份。
   *
   * 用合併而不是二選一：兩邊都可能有東西（家裡加了兩罐、公司加了一罐），
   * 不管覆蓋哪一邊都會弄丟客人加的東西。
   */
  useEffect(() => {
    const uid = user?.id ?? null
    if (uid === lastUserId.current) return
    const previous = lastUserId.current
    lastUserId.current = uid

    if (!uid) {
      // 登出：伺服器那份留著（下次登入還在），本機這份清空，
      // 不然下一個在同一台電腦登入的人會看到別人的購物車
      if (previous !== null) {
        skipNextPush.current = true
        setItems([])
      }
      return
    }

    if (!getToken()) return
    const local = items.map((i) => ({ product_id: i.id, quantity: i.quantity }))
    api.mergeCart(local)
      .then((rows) => {
        skipNextPush.current = true
        const merged = fromServer(rows)
        setItems(merged)
        const added = merged.length - items.length
        if (added > 0 && items.length > 0) {
          setToast(`已把你在其他裝置加入的 ${added} 項商品帶回購物車`)
        }
      })
      .catch(() => {})   // 拿不到就沿用本機的，不要讓購物車消失
    // items 刻意不放進相依：這裡只在「換人」的當下跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, fromServer])

  /** 購物車有變動就（延遲）推到伺服器。 */
  useEffect(() => {
    if (!user?.id || !getToken()) return undefined
    if (skipNextPush.current) {
      skipNextPush.current = false
      return undefined
    }
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(() => {
      api.saveCart(items.map((i) => ({ product_id: i.id, quantity: i.quantity })))
        .catch(() => {})   // 同步失敗不影響本機操作，下次變動會再試
    }, SYNC_DELAY)
    return () => clearTimeout(syncTimer.current)
  }, [items, user?.id])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(''), 3000)
    return () => clearTimeout(timer)
  }, [toast])

  /**
   * 加入購物車。會把「已在車上的數量」一起算進庫存上限。
   * 回傳 { added, capped, limit } 讓呼叫端可以顯示比較準的訊息。
   */
  const add = useCallback((product, quantity = 1) => {
    const limit = limitOf(product)
    const want = Math.max(1, Math.floor(Number(quantity) || 1))

    let result = { added: want, capped: false, limit }

    setItems((prev) => {
      const found = prev.find((i) => i.id === product.id)
      const already = found ? found.quantity : 0
      const room = Math.max(0, limit - already)
      const added = Math.min(want, room)
      result = { added, capped: added < want, limit }

      if (added <= 0) return prev
      if (found) {
        return prev.map((i) =>
          i.id === product.id ? { ...i, quantity: already + added, stock: product.stock } : i,
        )
      }
      return [
        ...prev,
        {
          id: product.id,
          name: product.name,
          price: Number(product.price),
          spec: product.spec || '',
          image_url: product.image_url || null,
          stock: product.stock,
          quantity: added,
        },
      ]
    })

    if (result.added <= 0) {
      setToast(
        result.limit === 0
          ? `「${product.name}」目前沒有庫存`
          : `「${product.name}」在購物車裡已達庫存上限 ${result.limit} 組`,
      )
    } else if (result.capped) {
      setToast(`庫存只剩 ${result.limit} 組，已將「${product.name}」加到上限`)
    } else {
      setToast(`已將「${product.name}」加入購物車`)
    }
    return result
  }, [])

  /** 修改數量。低於 1 會被拉回 1，超過庫存會被壓到庫存上限。 */
  const updateQty = useCallback((id, quantity) => {
    let capped = false
    let limit = Infinity

    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i
        limit = limitOf(i)
        const wanted = Math.max(1, Math.floor(Number(quantity) || 1))
        const next = Math.min(wanted, Math.max(1, limit))
        capped = next < wanted
        return { ...i, quantity: next }
      }),
    )

    if (capped && Number.isFinite(limit)) {
      setToast(`庫存只剩 ${limit} 組，無法再增加`)
    }
    return { capped, limit }
  }, [])

  /**
   * 用最新的商品資料校正購物車。
   *
   * `products` 是後端剛回傳的商品清單。回傳一份「改了什麼」的說明，
   * 好讓購物車頁可以老實告訴買家 —— 數量被偷偷改掉最容易讓人不信任。
   */
  const syncStock = useCallback((products, { allowUnpurchasable = false } = {}) => {
    const byId = new Map((products || []).map((p) => [p.id, p]))
    const notices = []

    setItems((prev) => {
      const next = []
      for (const item of prev) {
        const fresh = byId.get(item.id)

        if (!fresh || !fresh.is_active) {
          notices.push(`「${item.name}」已下架，已從購物車移除`)
          continue
        }

        // 加入購物車之後才被設成「不開放購買」的商品。
        // 留著只會讓客人在送出訂單時才被擋，那時他已經填完一整頁資料了。
        if (fresh.is_purchasable === false && !allowUnpurchasable) {
          const note = (fresh.unavailable_note || '').trim()
          notices.push(`「${item.name}」${note || '尚未開放購買'}，已從購物車移除`)
          continue
        }

        const limit = limitOf(fresh)
        if (limit === 0) {
          notices.push(`「${item.name}」已售完，已從購物車移除`)
          continue
        }

        const quantity = Math.min(item.quantity, limit)
        if (quantity < item.quantity) {
          notices.push(`「${item.name}」庫存只剩 ${limit} 組，數量已調整`)
        }

        const price = Number(fresh.price)
        if (price !== item.price) {
          notices.push(`「${item.name}」售價已更新為 NT$${price.toLocaleString('zh-TW')}`)
        }

        next.push({
          ...item,
          name: fresh.name,
          price,
          spec: fresh.spec || '',
          image_url: fresh.image_url || null,
          stock: fresh.stock,
          quantity,
        })
      }
      return next
    })

    return notices
  }, [])

  const remove = useCallback((id) => setItems((prev) => prev.filter((i) => i.id !== id)), [])

  /** 清空。訂單成立後會呼叫，伺服器那份也要一起清掉。 */
  const clear = useCallback(() => {
    skipNextPush.current = true
    setItems([])
    if (getToken()) api.clearCart().catch(() => {})
  }, [])

  const count = useMemo(() => items.reduce((s, i) => s + i.quantity, 0), [items])
  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.quantity, 0), [items])
  /** 有沒有任何一項超過庫存。結帳按鈕會依這個停用。 */
  const hasStockIssue = useMemo(
    () => items.some((i) => i.quantity > limitOf(i)),
    [items],
  )

  const value = useMemo(
    () => ({
      items, add, updateQty, remove, clear, syncStock,
      count, total, hasStockIssue, toast, setToast, limitOf,
    }),
    [items, add, updateQty, remove, clear, syncStock, count, total, hasStockIssue, toast],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart 必須在 CartProvider 內使用')
  return ctx
}
