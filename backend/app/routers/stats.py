"""瀏覽統計的端點。

記錄是公開的（每個訪客都要能送），查看只有工作人員。
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, Header, Query, Request
from sqlalchemy.orm import Session

from .. import analytics
from ..database import get_db
from ..deps import get_optional_user, require_staff
from ..models import User, UserRole

router = APIRouter(prefix="/api/stats", tags=["stats"])
log = logging.getLogger("honey")


def _client_ip(request: Request, forwarded: str) -> str:
    """取得訪客 IP。

    Zeabur 之類的平台會把請求轉一手，`request.client.host` 拿到的是
    反向代理的位址 —— 所有人都會長得一樣，不重複訪客就永遠是 1。
    所以優先看 `X-Forwarded-For` 的第一段（最原始的來源）。

    這個值只拿去做雜湊，不會存下來。
    """
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


@router.post("/view")
def record_view(
    request: Request,
    payload: dict = Body(default={}),
    x_forwarded_for: str = Header(default=""),
    user_agent: str = Header(default=""),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """記一次瀏覽。**公開端點** —— 每個訪客都要送得出來。

    ## 排除是兩層的

    前端會先判斷一次（工作人員、關掉統計的裝置就根本不送），
    這裡再擋一次。只靠前端的話，改一行 JS 就繞過去了；
    只靠後端的話，前端還是白白送出一堆請求。

    ## 為什麼永遠回 200

    統計失敗不該讓訪客看到任何異常。這支端點的失敗是完全無關緊要的事，
    不值得在使用者的主控台留下紅字。
    """
    # 工作人員自己在逛不算流量 —— 你每天開後台看十次，
    # 那些數字會蓋掉真實客人的樣子
    if user and user.role == UserRole.staff:
        return {"ok": True, "counted": False, "reason": "staff"}

    try:
        counted = analytics.record(
            db,
            path=str(payload.get("path") or "/"),
            ip=_client_ip(request, x_forwarded_for),
            user_agent=user_agent,
            referrer=str(payload.get("referrer") or ""),
        )
    except Exception as exc:  # noqa: BLE001 - 統計壞掉不該影響訪客
        log.warning("記錄瀏覽失敗：%s", exc)
        return {"ok": True, "counted": False, "reason": "error"}

    return {"ok": True, "counted": counted}


@router.get("/summary", dependencies=[Depends(require_staff)])
def stats_summary(days: int = Query(30, ge=1, le=180), db: Session = Depends(get_db)):
    return analytics.summary(db, days)
