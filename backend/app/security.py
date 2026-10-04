"""密碼雜湊（bcrypt）與登入權杖（JWT）。

刻意只用 bcrypt 與 PyJWT 兩個套件，兩者都提供各版本 Python 的預編譯 wheel，
在 Windows 上不需要安裝 Rust 或 C 編譯器。
"""
import hashlib
import hmac
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


def password_stamp(hashed_password: str) -> str:
    """密碼的「指紋」，放進登入權杖裡。

    改密碼或重設密碼之後 hashed_password 就變了，指紋對不上，
    所有舊的登入權杖一起失效 —— 其他裝置上的、被偷走的都一樣。
    登入會自動延長（見 /api/auth/refresh），沒有這一道的話，
    被偷走的權杖可以一直延長下去，改密碼也趕不走。

    用 SECRET_KEY 做 HMAC：權杖本身任何人都解得開，
    但從指紋推不回密碼雜湊，也偽造不出新的指紋。

    附帶的好處：就算 SECRET_KEY 外洩（2026-08 Zeabur 的環境變數外洩），
    光有金鑰也偽造不出能用的登入權杖 —— 還要知道那個人的密碼雜湊，那只在資料庫裡。
    """
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"login:{hashed_password}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:16]


def create_access_token(subject: str | int, hashed_password: str) -> str:
    """登入權杖，綁著這個人現在的密碼指紋（見 password_stamp）。"""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "iat": now,   # 前端看這個決定要不要換新的
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "pv": password_stamp(hashed_password),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def access_token_for(user) -> str:
    """發給這個使用者的登入權杖。"""
    return create_access_token(user.id, user.hashed_password)


def create_action_token(purpose: str, subject: str | int, minutes: int = 5) -> str:
    """短效、單一用途的權杖。

    用在「瀏覽器直接開一個網址」的情境 —— 例如列印託運單會 window.open
    到後端的網址，那是一次普通的瀏覽器導航，**不會帶 Authorization 標頭**
    （登入權杖存在 localStorage，只有 fetch 才會幫忙加上去）。
    所以那種頁面一定會被權限檢查擋下來，顯示「登入憑證無效或已過期」。

    解法不是把登入權杖放進網址 —— 那會留在瀏覽器紀錄、Referer 與伺服器日誌裡，
    而且它的效期是三十天、還會自動延長。這裡改發一個**只能做這件事、只有幾分鐘壽命**的權杖：
    被看到也只能列印那一張託運單，過幾分鐘就失效。
    反過來，它也不能拿來登入（decode_access_token 會擋有 act 的權杖）。
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


def decode_access_token(token: str) -> dict | None:
    """解開登入權杖。過期、簽章不對、或根本不是登入權杖，都回 None。"""
    try:
        # leeway：伺服器時鐘被校時往回撥幾秒時，剛發的權杖 iat 會變成「未來」而被拒，
        # 等於莫名其妙登出。給 10 秒寬限，對過期判斷的影響可以忽略。
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], leeway=10
        )
    except jwt.PyJWTError:
        return None
    # 有 act 的是短效通行證（例如列印託運單），它會出現在網址上。
    # 以前這裡沒擋，通行證在五分鐘內等於登入；現在登入可以延長，
    # 不擋的話還能拿它去換一張三十天的登入權杖。
    if "act" in payload or not payload.get("sub"):
        return None
    return payload


def decode_token(token: str) -> str | None:
    payload = decode_access_token(token)
    return payload.get("sub") if payload else None


def token_matches_password(payload: dict, hashed_password: str) -> bool:
    """權杖裡的密碼指紋要跟現在的密碼對得上（見 password_stamp）。

    沒有指紋的權杖一律不認，包括 2026-10 以前發的 —— 上線時大家要重新登入一次。
    想過放行舊權杖，但兩個洞都補不起來：
      - 舊權杖改密碼趕不走，還能拿去換一張綁「新密碼」的新權杖，等於永遠延長
      - SECRET_KEY 外洩的話，任何人都能自己做一張沒有指紋的權杖
    """
    stamp = payload.get("pv")
    if not stamp:
        return False
    return hmac.compare_digest(str(stamp), password_stamp(hashed_password))
