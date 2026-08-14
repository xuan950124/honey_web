from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import User, UserRole
from .security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

CREDENTIALS_ERROR = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="登入憑證無效或已過期，請重新登入",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not token:
        raise CREDENTIALS_ERROR
    user_id = decode_token(token)
    if not user_id:
        raise CREDENTIALS_ERROR
    user = db.get(User, int(user_id))
    if not user or not user.is_active:
        raise CREDENTIALS_ERROR
    return user


def get_optional_user(
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    if not token:
        return None
    user_id = decode_token(token)
    if not user_id:
        return None
    return db.get(User, int(user_id))


def require_staff(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.staff:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="此功能僅限工作人員帳號使用",
        )
    return user
