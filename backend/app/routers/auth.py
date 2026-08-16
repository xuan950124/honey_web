"""會員：註冊、登入、個人資料、信箱驗證、忘記密碼。

安全性重點：
  - 忘記密碼一律回同一句話，不透露這個 Email 有沒有註冊過（防帳號列舉）
  - 權杖只存雜湊，且一次性、有期限
  - 重設密碼後讓所有舊的重設連結失效
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_user
from ..mailer import render_email, send_email
from ..models import TokenPurpose, User, UserRole
from ..schemas import (
    EmailIn, PasswordChangeIn, PasswordResetIn, SimpleMessage, Token, TokenIn,
    UserLogin, UserOut, UserRegister, UserUpdate,
)
from ..security import create_access_token, hash_password, verify_password
from ..tokens import consume_token, issue_token, purge_expired, recently_sent

router = APIRouter(prefix="/api/auth", tags=["auth"])

# 不管信箱存不存在都回這句，避免被拿來探測哪些 Email 有註冊
FORGOT_REPLY = "如果這個 Email 有註冊過，我們已經寄出重設密碼的信，請到信箱查看。"


def _front(path: str) -> str:
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}{path}"


def _dev_url(url: str) -> str | None:
    """開發環境（未設定 SMTP）才回傳連結，方便不用收信就能測試。"""
    if settings.is_production or settings.smtp_configured:
        return None
    return url


# ---------------------------------------------------------------- 寄信

def _send_verify_email(db: Session, user: User) -> str:
    raw = issue_token(db, user, TokenPurpose.verify_email)
    url = _front(f"/verify-email?token={raw}")
    html = render_email(
        title="請驗證你的 Email",
        greeting=f"{user.name} 你好，",
        body_lines=[
            "感謝你註冊成為會員。請點下面的按鈕完成 Email 驗證，之後才能收到訂單與到貨通知。",
            f"這個連結在 {settings.VERIFY_TOKEN_HOURS} 小時內有效。",
        ],
        button_text="驗證我的 Email",
        button_url=url,
        footer_note="如果這不是你本人的操作，請直接忽略這封信，不會有任何影響。",
    )
    send_email(user.email, "請驗證你的 Email", html)
    return url


def _send_reset_email(db: Session, user: User) -> str:
    raw = issue_token(db, user, TokenPurpose.reset_password)
    url = _front(f"/reset-password?token={raw}")
    html = render_email(
        title="重設你的密碼",
        greeting=f"{user.name} 你好，",
        body_lines=[
            "我們收到了重設密碼的請求。點下面的按鈕就可以設定新密碼。",
            f"這個連結在 {settings.RESET_TOKEN_HOURS} 小時內有效，且只能使用一次。",
        ],
        button_text="設定新密碼",
        button_url=url,
        footer_note="如果不是你本人要求的，請忽略這封信，你的密碼不會有任何變動。",
    )
    send_email(user.email, "重設你的密碼", html)
    return url


# ---------------------------------------------------------------- 註冊 / 登入

@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="這個 Email 已經註冊過了")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        name=payload.name,
        phone=payload.phone,
        address=payload.address,
        role=UserRole.member,
    )
    db.add(user)
    db.flush()

    url = _send_verify_email(db, user)
    db.commit()
    db.refresh(user)

    return Token(
        access_token=create_access_token(user.id),
        user=UserOut.model_validate(user),
        dev_verify_url=_dev_url(url),
    )


@router.post("/login", response_model=Token)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Email 或密碼錯誤")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="此帳號已停用")
    return Token(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # 工作人員帳號是由管理者直接建立的，不需要走信箱驗證流程
    if user.role == UserRole.staff and not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now()
        db.commit()
        db.refresh(user)
    return user


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UserUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------- 信箱驗證

@router.post("/verify-email/resend", response_model=SimpleMessage)
def resend_verification(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.email_verified:
        return SimpleMessage(message="你的 Email 已經驗證過了")
    if recently_sent(db, user, TokenPurpose.verify_email):
        raise HTTPException(
            status_code=429,
            detail=f"剛剛才寄出過，請等 {settings.EMAIL_RESEND_COOLDOWN} 秒後再試",
        )

    url = _send_verify_email(db, user)
    db.commit()
    return SimpleMessage(message="驗證信已寄出，請到信箱查看", dev_url=_dev_url(url))


@router.post("/verify-email/confirm", response_model=SimpleMessage)
def confirm_verification(payload: TokenIn, db: Session = Depends(get_db)):
    user, error = consume_token(db, payload.token, TokenPurpose.verify_email)
    if not user:
        db.commit()
        raise HTTPException(status_code=400, detail=error)

    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now()
    purge_expired(db)
    db.commit()
    return SimpleMessage(message=f"{user.email} 驗證成功")


# ---------------------------------------------------------------- 忘記 / 重設密碼

@router.post("/password/forgot", response_model=SimpleMessage)
def forgot_password(payload: EmailIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()

    # 不論帳號存不存在，回應與耗時都盡量一致，避免被用來探測有效信箱
    if not user or not user.is_active:
        return SimpleMessage(message=FORGOT_REPLY)
    if recently_sent(db, user, TokenPurpose.reset_password):
        return SimpleMessage(message=FORGOT_REPLY)

    url = _send_reset_email(db, user)
    db.commit()
    return SimpleMessage(message=FORGOT_REPLY, dev_url=_dev_url(url))


@router.post("/password/reset", response_model=SimpleMessage)
def reset_password(payload: PasswordResetIn, db: Session = Depends(get_db)):
    user, error = consume_token(db, payload.token, TokenPurpose.reset_password)
    if not user:
        db.commit()
        raise HTTPException(status_code=400, detail=error)

    user.hashed_password = hash_password(payload.password)

    # 能收到重設信代表信箱是本人的，順便完成驗證
    if not user.email_verified:
        user.email_verified = True
        user.email_verified_at = datetime.now()

    purge_expired(db)
    db.commit()
    return SimpleMessage(message="密碼已更新，請用新密碼登入")


@router.post("/password/change", response_model=SimpleMessage)
def change_password(
    payload: PasswordChangeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="目前的密碼不正確")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密碼不能和目前的密碼一樣")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return SimpleMessage(message="密碼已更新")
