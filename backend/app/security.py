"""密碼雜湊（bcrypt）與登入權杖（JWT）。

刻意只用 bcrypt 與 PyJWT 兩個套件，兩者都提供各版本 Python 的預編譯 wheel，
在 Windows 上不需要安裝 Rust 或 C 編譯器。
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

# bcrypt 演算法本身只吃前 72 個位元組，超過的部分會被忽略。
# 明確截斷可避免新版 bcrypt 直接丟出例外。
_MAX_BYTES = 72


def _to_bytes(password: str) -> bytes:
    return password.encode("utf-8")[:_MAX_BYTES]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_to_bytes(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bytes(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str | int) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": str(subject), "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_action_token(purpose: str, subject: str | int, minutes: int = 5) -> str:
    """短效、單一用途的權杖。

    用在「瀏覽器直接開一個網址」的情境 —— 例如列印託運單會 window.open
    到後端的網址，那是一次普通的瀏覽器導航，**不會帶 Authorization 標頭**
    （登入權杖存在 localStorage，只有 fetch 才會幫忙加上去）。
    所以那種頁面一定會被權限檢查擋下來，顯示「登入憑證無效或已過期」。

    解法不是把登入權杖放進網址 —— 那會留在瀏覽器紀錄、Referer 與伺服器日誌裡，
    而且它的效期是七天。這裡改發一個**只能做這件事、只有幾分鐘壽命**的權杖：
    被看到也只能列印那一張託運單，過幾分鐘就失效。
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {"sub": str(subject), "act": purpose, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_action_token(token: str, purpose: str) -> str | None:
    """驗證短效權杖，回傳 subject。用途不符或過期都回 None。"""
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
    except jwt.PyJWTError:
        return None
    # 用途一定要比對 —— 少了這一行，登入權杖就能直接拿來當列印權杖用，
    # 那等於白做（這裡要的是「只能做這件事」）
    if payload.get("act") != purpose:
        return None
    return payload.get("sub")


def decode_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        return payload.get("sub")
    except jwt.PyJWTError:
        return None
