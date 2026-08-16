"""一次性權杖的產生與驗證（信箱驗證、重設密碼共用）。"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from .config import settings
from .models import AuthToken, TokenPurpose, User

TOKEN_BYTES = 32  # 產生 43 個字元的 URL-safe 隨機字串


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _lifetime(purpose: TokenPurpose) -> timedelta:
    hours = (
        settings.RESET_TOKEN_HOURS
        if purpose == TokenPurpose.reset_password
        else settings.VERIFY_TOKEN_HOURS
    )
    return timedelta(hours=hours)


def recently_sent(db: Session, user: User, purpose: TokenPurpose) -> bool:
    """是否在冷卻時間內已經寄過同用途的信，避免被當成寄信機器濫用。"""
    if settings.EMAIL_RESEND_COOLDOWN <= 0:
        return False
    since = datetime.now() - timedelta(seconds=settings.EMAIL_RESEND_COOLDOWN)
    return (
        db.query(AuthToken)
        .filter(
            AuthToken.user_id == user.id,
            AuthToken.purpose == purpose,
            AuthToken.created_at >= since,
        )
        .first()
        is not None
    )


def issue_token(db: Session, user: User, purpose: TokenPurpose) -> str:
    """產生新權杖，並讓同用途的舊權杖立刻失效。

    回傳原始權杖字串——只有這一次拿得到，之後資料庫裡只剩雜湊。
    """
    now = datetime.now()
    db.query(AuthToken).filter(
        AuthToken.user_id == user.id,
        AuthToken.purpose == purpose,
        AuthToken.used_at.is_(None),
    ).update({AuthToken.used_at: now}, synchronize_session=False)

    raw = secrets.token_urlsafe(TOKEN_BYTES)
    db.add(AuthToken(
        user_id=user.id,
        token_hash=hash_token(raw),
        purpose=purpose,
        expires_at=now + _lifetime(purpose),
    ))
    db.flush()
    return raw


def consume_token(db: Session, raw: str, purpose: TokenPurpose) -> tuple[User | None, str]:
    """驗證並使用掉一個權杖。回傳 (使用者, 錯誤訊息)。

    失效原因分開回報，讓前端能引導使用者重新申請。
    """
    if not raw or len(raw) > 200:
        return None, "連結不正確"

    record = (
        db.query(AuthToken)
        .filter(AuthToken.token_hash == hash_token(raw), AuthToken.purpose == purpose)
        .first()
    )
    if not record:
        return None, "連結不正確，或已經被使用過了"
    if record.used_at is not None:
        return None, "這個連結已經使用過了，請重新申請一次"
    if record.expires_at < datetime.now():
        return None, "連結已經過期，請重新申請一次"

    user = db.get(User, record.user_id)
    if not user or not user.is_active:
        return None, "找不到對應的帳號"

    record.used_at = datetime.now()
    return user, ""


def purge_expired(db: Session) -> int:
    """清掉過期超過 7 天的權杖記錄，避免資料表無限成長。"""
    cutoff = datetime.now() - timedelta(days=7)
    return (
        db.query(AuthToken)
        .filter(AuthToken.expires_at < cutoff)
        .delete(synchronize_session=False)
    )
