"""瀏覽統計：誰不算、怎麼算、資料留多久。

## 設計上的三個取捨

**不存 IP。** IP 在個資法下是個人資料。要算不重複訪客又需要分辨是不是同一個人，
所以存 `sha256(IP + User-Agent + 當天的鹽)`。鹽每天換 —— 反推不回原始 IP，
也**追蹤不了跨日的同一個人**。統計上略保守，但這是隱私友善該有的樣子。

**排除做兩層。** 前端不送 + 後端也擋。只靠前端的話，改一行 JS 就繞過去了；
只靠後端的話，前端還是白白送出一堆請求。

**資料會過期。** 一天幾百筆看起來沒什麼，一年就是十幾萬列。
店家關心的是「最近怎麼樣」，留 180 天足夠，再舊的自動刪掉。
"""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import date, datetime, timedelta
from urllib.parse import urlparse

from sqlalchemy import func
from sqlalchemy.orm import Session

from .models import PageView, SiteSetting

# 資料保留天數。再久的自動刪掉 —— 店家看的是「最近怎麼樣」。
RETENTION_DAYS = 180

# 鹽存在設定表，每天換一次
SALT_KEY = "analytics_salt"
SALT_DAY_KEY = "analytics_salt_day"

"""這些路徑不計入。

後台、購物車、訂單頁本來就不是「客人在逛」——
把它們算進瀏覽量只會讓數字虛胖，看不出真實的興趣。
訂單頁的網址還帶存取碼，更不該留下紀錄。
"""
IGNORED_PREFIXES = (
    "/admin", "/cart", "/order", "/member",
    "/login", "/register", "/reset-password", "/verify-email",
)

# 常見爬蟲。抓不完，但擋掉這些就少掉九成的假流量。
BOT_PATTERN = re.compile(
    r"bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|"
    r"telegram|line-?podcast|headless|lighthouse|pagespeed|gtmetrix|"
    r"uptime|pingdom|curl|wget|python-requests|axios|okhttp",
    re.I,
)


def _today() -> str:
    return date.today().isoformat()


def daily_salt(db: Session) -> str:
    """今天的鹽。跟昨天不一樣，所以雜湊值也不一樣。

    這是「不能跨日追蹤」的實作方式 —— 不是靠承諾，是靠算不出來。
    """
    today = _today()
    day_row = db.get(SiteSetting, SALT_DAY_KEY)
    salt_row = db.get(SiteSetting, SALT_KEY)

    if day_row and salt_row and day_row.value == today and salt_row.value:
        return salt_row.value

    fresh = secrets.token_hex(16)
    if salt_row:
        salt_row.value = fresh
    else:
        db.add(SiteSetting(key=SALT_KEY, value=fresh))
    if day_row:
        day_row.value = today
    else:
        db.add(SiteSetting(key=SALT_DAY_KEY, value=today))
    db.commit()
    return fresh


def visitor_hash(db: Session, ip: str, user_agent: str) -> str:
    raw = f"{ip}|{user_agent}|{daily_salt(db)}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def is_bot(user_agent: str) -> bool:
    if not user_agent or len(user_agent) < 10:
        return True   # 沒有 UA 的多半不是真人瀏覽器
    return bool(BOT_PATTERN.search(user_agent))


def is_ignored_path(path: str) -> bool:
    clean = (path or "/").split("?")[0]
    return any(clean.startswith(prefix) for prefix in IGNORED_PREFIXES)


def clean_path(path: str) -> str:
    """只留路徑，丟掉查詢字串。

    訂單頁的網址帶存取碼（?t=...），留下來等於把鑰匙寫進統計資料表。
    而且 `/products?category=a` 跟 `/products?category=b` 分開統計也沒有意義。
    """
    clean = (path or "/").split("?")[0].split("#")[0].strip()
    if not clean.startswith("/"):
        clean = "/" + clean
    return clean[:200]


def referrer_host(referrer: str) -> str | None:
    """只留來源網域。完整網址可能帶對方的查詢參數，沒必要留。"""
    if not referrer:
        return None
    try:
        host = urlparse(referrer).hostname or ""
    except ValueError:
        return None
    return host.lower()[:120] or None


def record(db: Session, *, path: str, ip: str, user_agent: str,
           referrer: str = "") -> bool:
    """記一筆瀏覽。回傳有沒有真的記進去。"""
    if is_bot(user_agent) or is_ignored_path(path):
        return False

    db.add(PageView(
        path=clean_path(path),
        visitor_hash=visitor_hash(db, ip, user_agent),
        referrer_host=referrer_host(referrer),
        day=_today(),
    ))
    db.commit()
    return True


def purge_old(db: Session, days: int = RETENTION_DAYS) -> int:
    """刪掉太舊的紀錄。回傳刪了幾筆。"""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    deleted = db.query(PageView).filter(PageView.day < cutoff).delete(
        synchronize_session=False
    )
    db.commit()
    return deleted


def summary(db: Session, days: int = 30) -> dict:
    """後台要看的數字。

    「不重複訪客」是當期間內不同 visitor_hash 的數量。
    因為鹽每天換，跨日的同一個人會被算成兩位 —— 這是隱私換來的代價，
    所以畫面上要講清楚，不然會以為系統算錯。
    """
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    today = _today()
    base = db.query(PageView).filter(PageView.day >= since)

    def count_for(start: str) -> tuple[int, int]:
        rows = db.query(
            func.count(PageView.id),
            func.count(func.distinct(PageView.visitor_hash)),
        ).filter(PageView.day >= start).one()
        return int(rows[0] or 0), int(rows[1] or 0)

    today_views, today_visitors = count_for(today)
    week_views, week_visitors = count_for(
        (date.today() - timedelta(days=6)).isoformat()
    )
    range_views, range_visitors = count_for(since)

    daily = [
        {"day": day, "views": int(views), "visitors": int(visitors)}
        for day, views, visitors in db.query(
            PageView.day,
            func.count(PageView.id),
            func.count(func.distinct(PageView.visitor_hash)),
        ).filter(PageView.day >= since).group_by(PageView.day)
        .order_by(PageView.day).all()
    ]

    top_pages = [
        {"path": path, "views": int(views), "visitors": int(visitors)}
        for path, views, visitors in db.query(
            PageView.path,
            func.count(PageView.id),
            func.count(func.distinct(PageView.visitor_hash)),
        ).filter(PageView.day >= since).group_by(PageView.path)
        .order_by(func.count(PageView.id).desc()).limit(15).all()
    ]

    sources = [
        {"host": host or "（直接輸入網址或從書籤）", "views": int(views)}
        for host, views in db.query(
            PageView.referrer_host, func.count(PageView.id),
        ).filter(PageView.day >= since).group_by(PageView.referrer_host)
        .order_by(func.count(PageView.id).desc()).limit(12).all()
    ]

    return {
        "days": days,
        "today": {"views": today_views, "visitors": today_visitors},
        "week": {"views": week_views, "visitors": week_visitors},
        "range": {"views": range_views, "visitors": range_visitors},
        "daily": daily,
        "top_pages": top_pages,
        "sources": sources,
        "retention_days": RETENTION_DAYS,
        "total_rows": int(base.count()),
        "generated_at": datetime.now(),
    }
