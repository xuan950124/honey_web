from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User, UserRole
from .security import decode_access_token, token_matches_password

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="登入憑證無效或已過期，請重新登入",
    headers={"WWW-Authenticate": "Bearer"},
)


def user_from_token(token: str | None, db: Session) -> User | None:
    """權杖有效才回傳使用者：簽章對、沒過期、帳號沒停用、密碼沒改過。"""
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload:
        return None
    try:
        user_id = int(payload["sub"])
    except (TypeError, ValueError):
        return None
    user = db.get(User, user_id)
    if not user or not user.is_active:
        return None
    # 改過密碼之後，舊的權杖（其他裝置上的、被偷走的）一律不認
    if not token_matches_password(payload, user.hashed_password):
        return None
    return user


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    user = user_from_token(token, db)
    if not user:
        raise CREDENTIALS_ERROR
    return user


def get_optional_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    # 權杖無效就當作沒登入（訪客），規則跟 get_current_user 一樣 ——
    # 以前這裡不看停用與密碼，停用的帳號在「可以不登入」的頁面還被當成本人。
    return user_from_token(token, db)


def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="此功能僅限工作人員帳號使用",
        )
    return user
