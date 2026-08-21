"""LINE webhook：接住按鈕與訊息。

## 為什麼一律回 200

LINE 的規則是：webhook 沒有在時限內回 200，就會被記一次失敗，
累積太多次會**自動把 webhook 停用**。

所以這裡就算內部出錯也回 200 —— 錯誤透過訊息告訴使用者，
而不是用 HTTP 狀態碼告訴 LINE。唯一的例外是簽章驗不過：
那代表這包資料根本不是 LINE 送的，回 400 才對。
"""
from __future__ import annotations

import logging
from urllib.parse import parse_qs

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session, joinedload

from .. import line
from ..config import settings
from ..database import get_db
from ..deps import require_staff
from ..models import Order, OrderStatus, PaymentStatus
from ..routers.logistics import build_logistics_order
from ..routers.orders import _decorate
from ..shipping import unpaid_expire_days

router = APIRouter(prefix="/api/line", tags=["line"])
log = logging.getLogger("honey")

OK = PlainTextResponse("OK")


@router.get("/status", dependencies=[Depends(require_staff)])
def line_status(db: Session = Depends(get_db)):
    """後台用來確認設定齊不齊。不回傳任何金鑰內容。"""
    return {
        "configured": line.is_configured(),
        "can_verify": line.can_verify(),
        "admin_count": len(line.admin_ids(db)),
        "webhook_url": f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/line/webhook",
        "ready": line.is_configured() and line.can_verify() and bool(line.admin_ids(db)),
    }


@router.post("/pair-code", dependencies=[Depends(require_staff)])
def make_pair_code(db: Session = Depends(get_db)):
    """產生一組配對碼，讓人在 LINE 打字加入通知名單。

    比「複製 33 個字元的 user ID 再貼進後台」可靠太多 ——
    那串東西用手機複製、切到電腦貼上，少一個字就整個不會動，
    而且**錯了完全沒有提示**，只會表現成「怎麼都收不到通知」。
    """
    return {"code": line.issue_pair_code(db), "minutes": line.PAIR_MINUTES}


@router.get("/recipients", dependencies=[Depends(require_staff)])
def list_recipients(db: Session = Depends(get_db)):
    """目前會收到通知的人。

    分開列出「後台設定的」與「環境變數來的」——
    環境變數那些在後台刪不掉，不講清楚會變成「怎麼刪都刪不掉」。
    """
    from ..config import settings as cfg

    from_env = line._split(cfg.LINE_ADMIN_USER_IDS)
    from_db = line._split(line._setting(db, line.ADMIN_IDS_KEY))
    return {
        "from_settings": sorted(from_db),
        "from_env": sorted(from_env),
    }


@router.delete("/recipients/{user_id}", dependencies=[Depends(require_staff)])
def remove_recipient(user_id: str, db: Session = Depends(get_db)):
    from ..config import settings as cfg

    if user_id in line._split(cfg.LINE_ADMIN_USER_IDS):
        raise HTTPException(
            status_code=400,
            detail="這個 ID 是環境變數 LINE_ADMIN_USER_IDS 設的，"
                   "要移除請到 Zeabur 改環境變數。",
        )
    current = line._split(line._setting(db, line.ADMIN_IDS_KEY))
    if user_id not in current:
        raise HTTPException(status_code=404, detail="名單裡沒有這個 ID")
    current.discard(user_id)
    line._save_setting(db, line.ADMIN_IDS_KEY, ",".join(sorted(current)))
    db.commit()
    return {"ok": True, "message": "已從通知名單移除。"}


@router.post("/test", dependencies=[Depends(require_staff)])
def send_test(db: Session = Depends(get_db)):
    """推一則測試訊息，確認整條路真的通。

    比對照設定表逐項檢查有用得多 —— 收到訊息就是通了，
    沒收到就看回傳的錯誤，不用猜是哪一段斷掉。
    """
    if not line.is_configured():
        return {"ok": False, "message": "還沒設定 LINE_CHANNEL_ACCESS_TOKEN。"}
    if not line.admin_ids(db):
        return {"ok": False, "message":
                "還沒設定 LINE_ADMIN_USER_IDS。加官方帳號好友後傳「我的ID」就查得到。"}

    sent = line.push_to_admins([line.text(
        "測試訊息：LINE 通知設定成功。\n\n"
        "之後有訂單就會推播到這裡，訊息上會有「建立物流單」按鈕。"
    )], db)
    if sent:
        return {"ok": True, "message": f"已送出給 {sent} 個帳號，請看你的 LINE。"}
    return {"ok": False, "message":
            "送出失敗。多半是 token 填錯或已被 Reissue，也可能是你還沒加官方帳號好友。"}


@router.post("/webhook")
async def webhook(
    request: Request,
    x_line_signature: str = Header(default=""),
    db: Session = Depends(get_db),
):
    body = await request.body()

    # 驗不過就不是 LINE 送的。這是唯一該回非 200 的情況。
    if not line.verify_signature(body, x_line_signature):
        log.warning("LINE webhook 簽章驗證失敗")
        return PlainTextResponse("bad signature", status_code=400)

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        return OK

    for event in payload.get("events", []):
        try:
            _handle(db, event)
        except Exception as exc:  # noqa: BLE001
            # 一個事件出錯不該讓整包失敗（LINE 會整包重送）
            log.exception("LINE 事件處理失敗：%s", exc)

    return OK


def _handle(db: Session, event: dict) -> None:
    kind = event.get("type")
    reply_token = event.get("replyToken") or ""
    user_id = (event.get("source") or {}).get("userId")

    if kind == "postback":
        _handle_postback(db, event, reply_token, user_id)
    elif kind == "message":
        _handle_message(db, event, reply_token, user_id)
    elif kind == "follow":
        line.reply(reply_token, [line.text(
            "已加入好友。\n\n"
            "要接收訂單通知的話，請店家到後台「網站設定 → LINE 通知機器人」"
            "按「產生配對碼」，然後把那六位數字傳到這裡就完成了。"
        )])


def _handle_message(db: Session, event: dict, reply_token: str, user_id: str | None) -> None:
    message = event.get("message") or {}
    if message.get("type") != "text":
        return
    content = (message.get("text") or "").strip()

    """「我的ID」對任何人開放，這是刻意的。

    設定白名單需要知道自己的 userId，而那組 ID 只有 LINE 傳事件時才拿得到。
    不開放的話會變成雞生蛋 —— 沒設白名單就查不到 ID，查不到 ID 就設不了白名單。
    回傳自己的 ID 給自己看沒有風險。
    """
    # 六位數字 = 配對碼。放在權限判斷**之前** ——
    # 還沒被加進名單的人才需要用配對碼，卡在權限後面就永遠用不到。
    if content.isdigit() and len(content) == 6:
        ok, message = line.redeem_pair_code(db, content, user_id or "")
        line.reply(reply_token, [line.text(message)])
        if ok:
            log.info("LINE：%s 透過配對碼加入通知名單", (user_id or "")[:8])
        return

    if content in ("我的ID", "我的id", "id", "ID"):
        line.reply(reply_token, [line.text(
            f"你的 LINE 使用者 ID：\n{user_id or '（拿不到，請從一對一聊天室傳）'}\n\n"
            "一般不需要用到這個 —— 到後台「網站設定 → LINE 通知機器人」"
            "按「產生配對碼」，把六位數字傳到這裡比較快，也不會打錯。"
        )])
        return

    if not line.is_admin(user_id, db):
        line.reply(reply_token, [line.text(
            "你好，這是黃家基蜜的通知機器人。\n"
            "訂購問題請直接留言，我們會盡快回覆。"
        )])
        return

    if content in ("訂單", "待出貨", "出貨"):
        _reply_pending(db, reply_token)
        return

    line.reply(reply_token, [line.text(
        "可以用的指令：\n"
        "・訂單 —— 列出待出貨的訂單\n"
        "・六位數字 —— 用後台產生的配對碼加入通知名單\n"
        "・我的ID —— 查自己的 LINE ID"
    )])


def _reply_pending(db: Session, reply_token: str) -> None:
    """列出待出貨的訂單。定義跟後台那邊一致：包裹還在你手上。"""
    orders = (
        db.query(Order).options(joinedload(Order.items))
        .filter(
            Order.status.notin_([OrderStatus.cancelled, OrderStatus.completed,
                                 OrderStatus.shipped]),
        )
        .order_by(Order.id.desc()).limit(20).all()
    )
    days = unpaid_expire_days(db)
    pending = [
        _decorate(o, days) for o in orders
        if o.allpay_logistics_id is None
        and (o.payment_status == PaymentStatus.paid
             or o.payment_method.value == "cod")
    ]

    if not pending:
        line.reply(reply_token, [line.text("目前沒有待建物流單的訂單。")])
        return

    # Flex 一次最多 5 則訊息；多的用文字列出來就好
    cards = [line.order_card(o, settings.FRONTEND_BASE_URL) for o in pending[:4]]
    if len(pending) > 4:
        cards.append(line.text(f"還有 {len(pending) - 4} 筆，請到後台處理。"))
    line.reply(reply_token, cards)


def _handle_postback(db: Session, event: dict, reply_token: str,
                     user_id: str | None) -> None:
    """按鈕。這是唯一會真的動到錢的路徑，權限要卡死。"""
    data = parse_qs((event.get("postback") or {}).get("data") or "")
    action = (data.get("act") or [""])[0]

    if not line.is_admin(user_id, db):
        # 簽章只證明「來自 LINE」，不代表「是老闆按的」——
        # 任何人加好友都能送 postback 進來
        line.reply(reply_token, [line.text(
            "這個功能只有店家本人可以使用。"
        )])
        log.warning("LINE：非授權使用者嘗試操作 %s（%s）", action, (user_id or "")[:8])
        return

    if action != "ship":
        line.reply(reply_token, [line.text("不認得這個指令。")])
        return

    try:
        order_id = int((data.get("order") or ["0"])[0])
    except ValueError:
        line.reply(reply_token, [line.text("訂單編號怪怪的，請到後台處理。")])
        return

    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.id == order_id).first()
    )
    if not order:
        line.reply(reply_token, [line.text("找不到這筆訂單，可能已經被刪掉了。")])
        return
    if order.allpay_logistics_id:
        # 重複按不該重複建單 —— 那會多扣一次運費
        line.reply(reply_token, [line.shipping_code_card(order, {
            "cvs_payment_no": order.cvs_payment_no,
            "cvs_validation_no": order.cvs_validation_no,
            "allpay_logistics_id": order.allpay_logistics_id,
        })])
        return

    try:
        result = build_logistics_order(db, order_id)
    except Exception as exc:  # noqa: BLE001
        line.reply(reply_token, [line.text(_error_text(exc))])
        return

    db.refresh(order)
    line.reply(reply_token, [line.shipping_code_card(order, result)])


def _error_text(exc: Exception) -> str:
    """把建單失敗翻成手機上看得懂的一段話。

    後台那邊會把處理步驟排成清單，但 LINE 塞不下那麼多 ——
    所以只給標題與最關鍵的第一步，細節請他打開後台。
    """
    detail = getattr(exc, "detail", None)
    if isinstance(detail, dict):
        steps = detail.get("steps") or []
        first = steps[0].replace("**", "") if steps else ""
        return f"建立物流單失敗：{detail.get('title', '')}\n\n{first}\n\n詳細處理步驟請看後台。"
    if isinstance(detail, str):
        return f"建立物流單失敗：{detail}"
    return f"建立物流單失敗：{exc}"
