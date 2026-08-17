import { Link } from 'react-router-dom'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'

const Empty = () => <span className="footer__empty">（待補）</span>
const SETTINGS = '/admin/settings'

export default function Footer() {
  const { settings, loaded } = useSettings()
  const year = new Date().getFullYear()

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div>
            <div className={`footer__brand${loaded ? '' : ' is-pending'}`}
                 {...editable('網站名稱', SETTINGS, 'shop_name')}>
              {settings.shop_name || '蜂蜜工坊'}
            </div>
            {/*
              這裡用 hero_desc 而不是 shop_slogan。
              shop_slogan 是頁首橫條那句短標語，拿來當頁尾的品牌介紹太短，
              而且頁首已經出現過一次，重複沒有意義。
            */}
            <p className={`footer__desc${loaded ? '' : ' is-pending'}`}
               {...editable('品牌介紹', SETTINGS, 'hero_desc', '這一段跟首頁大標下的說明是同一個欄位。')}>
              {settings.hero_desc ||
                '基隆七堵的自家蜂場。等蜜在巢裡封蓋熟成才採收，裝瓶前不加水、不加糖，每一瓶都查得到生產者。'}
            </p>
            {settings.traceability_code && (
              <a
                {...editable('溯源追溯編號', SETTINGS, 'traceability_code')}
                className="trace-badge"
                href={`https://qrc.afa.gov.tw/blog/${settings.traceability_code}`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="trace-badge__label">農業部溯源追溯編號</span>
                <span className="trace-badge__code">{settings.traceability_code}</span>
              </a>
            )}
          </div>

          {/* data-edit-skip：編輯模式下這兩欄還是純導覽，點了要真的換頁 */}
          <div data-edit-skip>
            <h4>網站導覽</h4>
            <ul>
              <li><Link to="/products">蜂蜜商品</Link></li>
              <li><Link to="/group-buy">團購專區</Link></li>
              <li><Link to="/news">新聞報導</Link></li>
              <li><Link to="/story">品牌故事</Link></li>
              <li><Link to="/contact">聯絡我們</Link></li>
            </ul>
          </div>

          <div data-edit-skip>
            <h4>會員服務</h4>
            <ul>
              <li><Link to="/login">會員登入</Link></li>
              <li><Link to="/register">加入會員</Link></li>
              <li><Link to="/member">訂單查詢</Link></li>
              <li><Link to="/cart">購物車</Link></li>
            </ul>
          </div>

          <div {...editable('聯絡資訊', SETTINGS, 'contact_phone', '電話、LINE、地址、Email、營業時間都在「網站設定 → 聯絡資訊與基本設定」。')}>
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
          <span className={loaded ? '' : 'is-pending'}>
            © {year} {settings.shop_name || '蜂蜜工坊'}．All rights reserved.
          </span>
          <span>本網站商品照片與文案內容陸續更新中</span>
        </div>
      </div>
    </footer>
  )
}
