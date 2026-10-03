import { Link } from 'react-router-dom'
import { editable } from '../context/EditModeContext'
import { useSettings } from '../context/SettingsContext'
import { Lettering } from './Brand'
import TraceStamp from './TraceStamp'
import { prose } from '../lib/text'

// 後台還沒填的欄位。不自己編內容，照實寫「待填」
const Empty = () => <span className="footer__empty">待填</span>
const SETTINGS = '/admin/settings'

export default function Footer() {
  const { settings, loaded } = useSettings()
  const year = new Date().getFullYear()

  // 只列有填的。空的欄位對客人露出來只會顯得沒做完
  const business = [
    ['商號', settings.business_name],
    ['統一編號', settings.business_tax_id],
    ['食品業者登錄字號', settings.food_registration_no],
    ['負責人', settings.business_owner],
    ['地址', settings.business_address],
    ['電話', settings.business_phone],
  ].filter(([, v]) => Boolean((v || '').trim()))

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__about">
            {/* 店家的圓形 Logo 貼紙（Huang's Keelung Honey・100% Natural Forest Product） */}
            <Lettering name="seal" className="footer__seal" label="黃家基蜜 Huang's Keelung Honey" />
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
              {prose(settings.hero_desc ||
                '基隆七堵的自家蜂場。等蜜在巢裡封蓋熟成才採收，裝瓶前不加水、不加糖，每一瓶都查得到生產者。')}
            </p>
            <TraceStamp variant="footer" />
          </div>

          {/* data-edit-skip：編輯模式下這兩欄還是純導覽，點了要真的換頁 */}
          <div data-edit-skip>
            <h2 className="footer__heading">網站導覽</h2>
            <ul className="footer__links">
              <li><Link to="/products">蜂蜜商品</Link></li>
              <li><Link to="/group-buy">團購專區</Link></li>
              <li><Link to="/news">新聞報導</Link></li>
              <li><Link to="/story">品牌故事</Link></li>
              <li><Link to="/contact">聯絡我們</Link></li>
            </ul>
          </div>

          <div data-edit-skip>
            <h2 className="footer__heading">會員與條款</h2>
            <ul className="footer__links">
              <li><Link to="/login">會員登入</Link></li>
              <li><Link to="/member">訂單查詢</Link></li>
              <li><Link to="/refund">退換貨政策</Link></li>
              <li><Link to="/privacy">隱私權政策</Link></li>
              <li><Link to="/terms">服務條款</Link></li>
            </ul>
          </div>

          <div {...editable('聯絡資訊', SETTINGS, 'contact_phone', '電話、LINE、地址、Email、營業時間都在「網站設定 → 聯絡資訊與基本設定」。')}>
            <h2 className="footer__heading">聯絡資訊</h2>
            <dl className="footer__contact">
              <div>
                <dt>電話</dt>
                <dd>
                  {settings.contact_phone ? (
                    <a href={`tel:${settings.contact_phone}`}>{settings.contact_phone}</a>
                  ) : (
                    <Empty />
                  )}
                </dd>
              </div>
              <div><dt>LINE</dt><dd>{settings.line_id || <Empty />}</dd></div>
              <div><dt>地址</dt><dd>{settings.contact_address || <Empty />}</dd></div>
              <div><dt>Email</dt><dd>{settings.contact_email || <Empty />}</dd></div>
              <div><dt>營業時間</dt><dd>{settings.business_hours || <Empty />}</dd></div>
            </dl>
          </div>
        </div>

        {/*
          業者資訊。食安法要求的是「廠商名稱、地址、電話」——
          統編與食品業者登錄字號則是有才顯示：自產自銷的農民免辦營業登記，
          本來就沒有統編，也不在「非登不可」的強制對象內。
          沒填的欄位一律不顯示，不要對客人露出空欄位。
        */}
        {business.length > 0 && (
          <div className="footer__legal"
               {...editable('業者資訊', '/admin/policies', 'business_name',
                 '商號名稱、負責人、地址、電話都在「政策條款 → 業者資訊」。')}>
            {business.map(([label, value]) => (
              <span key={label}>
                <span className="footer__legal-label">{label}</span>
                {value}
              </span>
            ))}
          </div>
        )}

        <div className="footer__bottom">
          <span className={loaded ? '' : 'is-pending'}>
            © {year} {settings.shop_name || '蜂蜜工坊'}．All rights reserved.
          </span>
          <span className="footer__policy-links">
            <Link to="/privacy">隱私權</Link>
            <Link to="/terms">服務條款</Link>
            <Link to="/refund">退換貨</Link>
          </span>
        </div>
      </div>
    </footer>
  )
}
