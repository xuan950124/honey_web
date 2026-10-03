/**
 * 還沒有照片時的插畫（Placeholder 的 art）。
 *
 * 不另外畫一套風格：蜂場、故事、報導這類位置直接用店家標籤上的紅淡比開花枝條
 * （public/brand/art-cleyera.svg，從標籤完稿拆出來的向量檔），放在紅淡比的珊瑚紅上；
 * 商品照的位置畫一個六角蜂蜜罐，配色一樣取自標籤（蜂蜜黃、珊瑚紅、花白、花蕊橘、墨）。
 *
 * 這些只是頂著用的，客人看得出是插畫，不會被當成實拍照片。
 */
function Branch() {
  return (
    <div className="art art--branch" aria-hidden="true">
      <img src="/brand/art-cleyera.svg" alt="" loading="lazy" />
    </div>
  )
}

function Jar() {
  // 五片花瓣的小花（標籤上紅淡比花的簡化版）
  const petals = [0, 72, 144, 216, 288]
  return (
    <svg viewBox="0 0 240 240" className="art art--jar" aria-hidden="true">
      <rect width="240" height="240" className="art__ground" />
      <rect x="86" y="40" width="68" height="26" rx="5" className="art__ink" />
      <rect x="92" y="64" width="56" height="12" className="art__honey-deep" />
      <path d="M72 78h96l18 30v86l-18 18H72l-18-18v-86Z" className="art__honey" />
      <path d="M78 92h18v104H78l-8-8V110Z" className="art__shine" />
      <rect x="66" y="122" width="108" height="62" className="art__label" />
      <g transform="translate(120 153)">
        {petals.map((r) => (
          <ellipse key={r} cx="0" cy="-12" rx="8" ry="12" transform={`rotate(${r})`} className="art__petal" />
        ))}
        <circle r="5.5" className="art__stamen" />
      </g>
    </svg>
  )
}

const ART = { apiary: Branch, comb: Branch, jar: Jar }

export default function Art({ name = 'apiary' }) {
  const Drawing = ART[name] || Branch
  return <Drawing />
}
