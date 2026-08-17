import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const CartContext = createContext(null)
const CART_KEY = 'honey_cart'

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
  const [items, setItems] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch {
      return []
    }
  })
  const [toast, setToast] = useState('')

  useEffect(() => {
    localStorage.setItem(CART_KEY, JSON.stringify(items))
  }, [items])

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
  const syncStock = useCallback((products) => {
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
  const clear = useCallback(() => setItems([]), [])

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
