import { useCallback, useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../api/client'
import Art from './Art'
import Icon from './Icon'
import Placeholder from './Placeholder'

/**
 * 商品照片輪播。
 *
 * 每一張照片疊在同一個位置，用透明度切換（.gallery__slide）。
 * 這樣換張不會讓版面跳動，截圖檢查時也能一張一張拍。
 *
 * - 電腦：下方縮圖點了就換；滑鼠拖曳也可以
 * - 手機：左右滑。快速一撥就算數（速度超過 0.11 px/ms），
 *   不用真的拖過一半；拖到第一張或最後一張再往外拉，會越拉越緊
 * - 鍵盤：輪播框取得焦點後用左右鍵
 */
const FLICK = 0.11      // px/ms，超過就換張（不管拖了多遠）
const DISTANCE = 0.2    // 拖過寬度的兩成也換張

export default function Gallery({ images, alt, hint }) {
  const [index, setIndex] = useState(0)
  // 載入失敗的那幾張改畫插畫，不要露出破圖
  const [broken, setBroken] = useState({})
  const viewport = useRef(null)
  const drag = useRef(null)
  const count = images.length

  // 換商品時回到第一張
  const key = images.join('|')
  useEffect(() => { setIndex(0); setBroken({}) }, [key])

  const go = useCallback((next) => {
    setIndex((i) => {
      const n = typeof next === 'function' ? next(i) : next
      return Math.max(0, Math.min(count - 1, n))
    })
  }, [count])

  const slides = () => (viewport.current ? [...viewport.current.querySelectorAll('.gallery__slide')] : [])

  const reset = () => {
    for (const el of slides()) {
      el.style.transform = ''
      el.style.opacity = ''
      el.style.transition = ''
    }
  }

  const onPointerDown = (e) => {
    if (count < 2 || drag.current) return        // 已經在拖了，第二根手指不理它
    if (e.pointerType === 'mouse' && e.button !== 0) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, active: false }
  }

  const onPointerMove = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.active) {
      // 先確定是橫向在滑，不是在捲頁面
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
        if (Math.abs(dy) > 12) drag.current = null
        return
      }
      d.active = true
      viewport.current.setPointerCapture(e.pointerId)
    }
    const width = viewport.current.clientWidth
    const neighbour = dx < 0 ? index + 1 : index - 1
    const edge = neighbour < 0 || neighbour >= count
    // 邊界上越拉越緊，不是撞牆
    d.dx = edge ? dx * 0.3 : dx
    const [current, next] = [slides()[index], slides()[neighbour]]
    const progress = Math.min(1, Math.abs(d.dx) / width)
    if (current) {
      current.style.transition = 'none'
      current.style.transform = `translateX(${d.dx}px)`
      current.style.opacity = String(1 - progress * 0.6)
    }
    if (next && !edge) {
      next.style.transition = 'none'
      next.style.opacity = String(progress)
    }
  }

  const onPointerUp = (e) => {
    const d = drag.current
    if (!d || e.pointerId !== d.id) return
    drag.current = null
    if (!d.active) return
    const width = viewport.current.clientWidth
    const velocity = Math.abs(d.dx) / Math.max(1, performance.now() - d.t)
    const far = Math.abs(d.dx) > width * DISTANCE
    reset()
    if (far || velocity > FLICK) go((i) => (d.dx < 0 ? i + 1 : i - 1))
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go((i) => i + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go((i) => i - 1) }
  }

  if (!count) {
    return (
      <div className="gallery">
        <Placeholder ratio="1x1" art="jar" alt={alt} hint={hint} />
      </div>
    )
  }

  return (
    <div className="gallery" role="region" aria-roledescription="輪播" aria-label={`${alt} 照片`}>
      <div
        ref={viewport}
        className={`gallery__viewport${count > 1 ? ' is-swipeable' : ''}`}
        tabIndex={count > 1 ? 0 : undefined}
        onKeyDown={count > 1 ? onKeyDown : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; reset() }}
      >
        {images.map((url, i) => (
          <div
            key={url + i}
            className={`gallery__slide${i === index ? ' is-active' : ''}`}
            aria-hidden={i === index ? undefined : 'true'}
          >
            {broken[i] ? (
              <div className="ph ph--1x1 ph--art" role="img" aria-label={alt}><Art name="jar" /></div>
            ) : (
              <img
                src={mediaUrl(url)}
                alt={count > 1 ? `${alt}（第 ${i + 1} 張，共 ${count} 張）` : alt}
                loading={i === 0 ? 'eager' : 'lazy'}
                draggable="false"
                onError={() => setBroken((b) => ({ ...b, [i]: true }))}
              />
            )}
          </div>
        ))}

        {count > 1 && (
          <span className="gallery__count" aria-hidden="true">
            {index + 1} / {count}
          </span>
        )}
      </div>

      {count > 1 && (
        <>
          <div className="gallery__nav">
            <button type="button" className="gallery__arrow" onClick={() => go((i) => i - 1)}
                    disabled={index === 0} aria-label="上一張">
              <Icon name="chevronLeft" />
            </button>
            <div className="gallery__dots">
              {images.map((url, i) => (
                <button key={url + i} type="button"
                        className={`gallery__dot${i === index ? ' is-active' : ''}`}
                        aria-label={`第 ${i + 1} 張`}
                        aria-current={i === index ? 'true' : undefined}
                        onClick={() => go(i)} />
              ))}
            </div>
            <button type="button" className="gallery__arrow" onClick={() => go((i) => i + 1)}
                    disabled={index === count - 1} aria-label="下一張">
              <Icon name="chevronRight" />
            </button>
          </div>

          <div className="gallery__thumbs">
            {images.map((url, i) => (
              <button
                key={url + i}
                type="button"
                className={`gallery__thumb${i === index ? ' is-active' : ''}`}
                onClick={() => go(i)}
                aria-label={`看第 ${i + 1} 張`}
                aria-current={i === index ? 'true' : undefined}
              >
                <img src={mediaUrl(url)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
