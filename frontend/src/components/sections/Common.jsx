/**
 * 各頁共用的小零件：區段標題、頁面標題、空狀態。
 *
 * 區段標題刻意沒有「標題上方的英文小字」—— 標題自己就夠大，
 * 多一行小字只是裝飾，還會把真正的標題往下推。
 */

export function SectionHead({ title, desc, action, id, className = '' }) {
  return (
    <div className={`section-head${className ? ` ${className}` : ''}`}>
      <div className="section-head__text">
        <h2 className="section-head__title" id={id}>{title}</h2>
        {desc && <p className="section-head__desc">{desc}</p>}
      </div>
      {action && <div className="section-head__action">{action}</div>}
    </div>
  )
}

/**
 * 內頁最上面的頁名。
 *
 * tone：這一頁用標籤上的哪一個顏色當整片色場——
 *   coral（紅淡比的正面）、honey（紅淡比的資訊面）、ink（墨）、bloom（花白）；
 *   sky／lime 是鴨腳木標籤的正面與資訊面，只留給鴨腳木花系的頁面。
 *   不給就是白底（購物車、會員中心這種「來辦事」的頁面，把畫面留給表單）。
 * art：右下角露出一段標籤插畫（cleyera 紅淡比、schefflera 鴨腳木）。只是裝飾，花要跟頁面講的蜜同一個花系。
 * compact：矮一點的版本。
 */
export function PageHero({ title, desc, children, tone = '', art = '', compact = false }) {
  const cls = ['page-hero', tone && `page-hero--${tone}`, compact && 'page-hero--compact', art && 'page-hero--art']
    .filter(Boolean).join(' ')
  return (
    <section className={cls}>
      {art && <img className={`page-hero__art page-hero__art--${art}`} src={`/brand/art-${art}.svg`} alt="" aria-hidden="true" />}
      <div className="container">
        <h1 className="page-hero__title">{title}</h1>
        {desc && <p className="page-hero__desc">{desc}</p>}
        {children}
      </div>
    </section>
  )
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
