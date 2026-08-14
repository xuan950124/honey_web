import { Link } from 'react-router-dom'
import { useSettings } from '../context/SettingsContext'

const Empty = () => <span className="footer__empty">（待補）</span>

export default function Footer() {
  const { settings } = useSettings()
  const year = new Date().getFullYear()

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <div className="footer__brand">{settings.shop_name || '蜂蜜工坊'}</div>
            <p className="footer__desc">
              {settings.shop_slogan ||
                '我們相信好蜂蜜不需要多餘的加工。每一瓶都來自自家蜂場，依花期採收、靜置熟成後裝瓶，把台灣土地的甜味完整交到你手上。'}
            </p>
          </div>

          <div>
            <h4>網站導覽</h4>
            <ul>
              <li><Link to="/products">蜂蜜商品</Link></li>
              <li><Link to="/group-buy">團購專區</Link></li>
              <li><Link to="/news">新聞報導</Link></li>
              <li><Link to="/story">品牌故事</Link></li>
              <li><Link to="/contact">聯絡我們</Link></li>
            </ul>
          </div>

          <div>
            <h4>會員服務</h4>
            <ul>
              <li><Link to="/login">會員登入</Link></li>
              <li><Link to="/register">加入會員</Link></li>
              <li><Link to="/member">訂單查詢</Link></li>
              <li><Link to="/cart">購物車</Link></li>
            </ul>
          </div>

          <div>
            <h4>聯絡資訊</h4>
            <ul>
              <li>
                電話：
                {settings.contact_phone ? (
                  <a href={`tel:${settings.contact_phone}`}>{settings.contact_phone}</a>
                ) : (
                  <Empty />
                )}
              </li>
              <li>LINE：{settings.line_id || <Empty />}</li>
              <li>地址：{settings.contact_address || <Empty />}</li>
              <li>Email：{settings.contact_email || <Empty />}</li>
              <li>營業時間：{settings.business_hours || <Empty />}</li>
            </ul>
          </div>
        </div>

        <div className="footer__bottom">
          <span>© {year} {settings.shop_name || '蜂蜜工坊'}．All rights reserved.</span>
          <span>本網站商品照片與文案內容陸續更新中</span>
        </div>
      </div>
    </footer>
  )
}
