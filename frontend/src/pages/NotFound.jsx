import { Link } from 'react-router-dom'
import { Bee } from '../components/Brand'
import Icon from '../components/Icon'

export default function NotFound() {
  return (
    <section className="not-found">
      <div className="container">
        {/* 整片珊瑚紅（標籤的正面），標籤上那隻蜜蜂飛到這裡來找路 */}
        <p className="not-found__code" aria-hidden="true">
          404
          <Bee className="not-found__bee" />
        </p>
        <h1 className="not-found__title">找不到這個頁面，可能已被移除或網址輸入錯誤。</h1>
        <Link to="/" className="btn btn--ink btn--lg">回到首頁<Icon name="arrow" /></Link>
      </div>
    </section>
  )
}
