"""LINE 官方帳號：訂單通知與遠端建立物流單。

## 這個功能在解決什麼

出貨最花時間的不是包裝，是「打開電腦、登入後台、找到那筆訂單、按建立物流單、
抄下寄件代碼」。手機收到通知直接按一顆按鈕就拿到寄件代碼，
包好包裹就能出門，中間不必碰電腦。

## 安全性：這是一個「按了就會花錢」的遙控器

按下「建立物流單」會真的向綠界建單，而**超商運費是從你的綠界餘額先扣的**。
所以這裡有兩道關卡，缺一不可：

1. **簽章驗證** —— webhook 網址是公開的，任何人都能 POST 假事件進來。
   LINE 會用 channel secret 對整包 body 做 HMAC-SHA256 並放在
   `X-Line-Signature`，驗不過就直接丟掉。
2. **操作者白名單** —— 簽章只證明「這是 LINE 傳來的」，
   不代表「這是老闆按的」。任何人加你的官方帳號好友都能傳事件，
   所以還要比對 `source.userId` 在不在 `LINE_ADMIN_USER_IDS` 裡。

沒設定白名單時**一律拒絕操作**（但仍會回覆使用者自己的 ID，
不然沒有人知道該把什麼填進設定）。
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
from typing import Any

import httpx

from .config import settings
from .models import Order, PaymentStatus

log = logging.getLogger("honey")

API = "https://api.line.me/v2/bot"
TIMEOUT = 10.0


def is_configured() -> bool:
    """有 token 才推得出訊息。"""
    return bool(settings.LINE_CHANNEL_ACCESS_TOKEN.strip())


def can_verify() -> bool:
    """有 channel secret 才驗得了簽章。驗不了就不該開放 webhook。"""
    return bool(settings.LINE_CHANNEL_SECRET.strip())


# 收件人名單存在網站設定裡（後台可以改），環境變數當備援。
#
# 為什麼不是只用環境變數：改一次要重新部署，而「誰要收通知」是會變的事
# （多請一個人幫忙出貨、換手機重加好友）。
# 為什麼環境變數還留著：資料庫還沒起來或設定被清掉時，至少還有一條路能收通知。
#
# token 與 secret **不**搬進資料庫 —— 那是憑證，放進設定表就會被後台的表單
# 讀出來顯示，等於多一個外洩點。收件人 ID 不是憑證，只是一份名單。
ADMIN_IDS_KEY = "line_admin_user_ids"


def _split(raw: str) -> set[str]:
    """逗號或換行分隔都接受 —— 貼上來的東西什麼格式都有。"""
    return {
        part.strip()
        for chunk in (raw or "").replace("\n", ",").split(",")
        for part in [chunk]
        if part.strip()
    }


def admin_ids(db) -> set[str]:
    """誰會收到通知、誰按得動按鈕。

    後台設定與環境變數**取聯集** —— 兩邊都算數。
    這樣既可以在後台隨時加人，環境變數那條後路也還在。

    ## db 是必填，不給預設值

    這個參數原本是選填（`db=None`），結果三個呼叫點全都忘了傳，
    於是只讀得到環境變數那一份 —— 而用配對碼加進來的人是存在**資料庫**裡的。

    表現出來就是「付完款完全沒收到通知，也沒有任何錯誤訊息」，
    跟沒設定一模一樣，查了很久才發現。

    所以現在漏傳會直接 TypeError。**吵鬧的失敗遠比安靜的失敗好** ——
    尤其是這種「不會有人發現」的功能。
    """
    ids = _split(settings.LINE_ADMIN_USER_IDS)
    ids |= _split(_setting(db, ADMIN_IDS_KEY))
    return ids


def _setting(db, key: str) -> str:
    from .models import SiteSetting

    try:
        row = db.get(SiteSetting, key)
    except Exception:  # noqa: BLE001 - 設定讀不到不該讓通知整個爆掉
        return ""
    return (row.value or "") if row else ""


def _save_setting(db, key: str, value: str) -> None:
    from .models import SiteSetting

    row = db.get(SiteSetting, key)
    if row:
        row.value = value
    else:
        db.add(SiteSetting(key=key, value=value))


def add_admin(db, user_id: str) -> bool:
    """把一個人加進名單。已經在裡面就回 False。"""
    current = _split(_setting(db, ADMIN_IDS_KEY))
    if user_id in current or user_id in _split(settings.LINE_ADMIN_USER_IDS):
        return False
    current.add(user_id)
    _save_setting(db, ADMIN_IDS_KEY, ",".join(sorted(current)))
    db.commit()
    return True


def is_admin(user_id: str | None, db) -> bool:
    ids = admin_ids(db)
    return bool(user_id and ids and user_id in ids)


def verify_signature(body: bytes, signature: str) -> bool:
    """驗證這包資料真的來自 LINE。

    用 `compare_digest` 而不是 `==` —— 字串比較會在第一個不同的位元組就回傳，
    攻擊者可以從回應時間反推出正確的簽章（時序攻擊）。
    """
    if not can_verify() or not signature:
        return False
    digest = hmac.new(
        settings.LINE_CHANNEL_SECRET.encode("utf-8"), body, hashlib.sha256
    ).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, signature)


# ---------------------------------------------------------------- 送出

def _post(path: str, payload: dict) -> tuple[bool, str]:
    if not is_configured():
        return False, "尚未設定 LINE_CHANNEL_ACCESS_TOKEN"
    try:
        resp = httpx.post(
            f"{API}{path}",
            headers={
                "Authorization": f"Bearer {settings.LINE_CHANNEL_ACCESS_TOKEN}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        return False, f"連線失敗：{exc}"

    if resp.status_code // 100 == 2:
        return True, "ok"
    return False, f"LINE 回 {resp.status_code}：{resp.text[:200]}"


def reply(reply_token: str, messages: list[dict]) -> tuple[bool, str]:
    """回覆訊息。**只能用一次、而且有時效**，所以失敗就別重試。"""
    return _post("/message/reply", {"replyToken": reply_token, "messages": messages[:5]})


def push(to: str, messages: list[dict]) -> tuple[bool, str]:
    return _post("/message/push", {"to": to, "messages": messages[:5]})


def push_to_admins(messages: list[dict], db) -> int:
    """推播給所有設定的管理者，回傳成功幾個。

    **絕對不能讓這裡的失敗影響下單流程** —— LINE 掛掉、token 過期、
    網路不通都不該讓客人結不了帳。所以全部包起來，只記錄不拋出。
    """
    sent = 0
    for user_id in admin_ids(db):
        try:
            ok, message = push(user_id, messages)
        except Exception as exc:  # noqa: BLE001
            ok, message = False, str(exc)
        if ok:
            sent += 1
        else:
            log.warning("LINE 推播失敗（%s）：%s", user_id[:8], message)
    return sent


# ---------------------------------------------------------------- 訊息內容

def text(content: str) -> dict:
    # LINE 的文字訊息上限 5000 字，超過整則會被退回
    return {"type": "text", "text": content[:4900]}


def _row(label: str, value: str) -> dict:
    return {
        "type": "box", "layout": "baseline", "spacing": "sm",
        "contents": [
            {"type": "text", "text": label, "size": "sm", "color": "#9a8e7d", "flex": 2},
            {"type": "text", "text": value or "—", "size": "sm", "color": "#3b2712",
             "flex": 5, "wrap": True},
        ],
    }


def order_card(order: Order, front_url: str) -> dict:
    """新訂單的通知卡片，附「建立物流單」按鈕。

    按鈕用 postback 而不是 uri —— uri 會把人丟到瀏覽器再登入一次後台，
    那就失去「在 LINE 裡面直接處理完」的意義了。
    """
    items = "、".join(
        f"{i.product_name}×{i.quantity}" for i in (order.items or [])
    ) or "（無明細）"

    ship_to = order.cvs_store_name or order.receiver_address or "—"
    paid = order.payment_status == PaymentStatus.paid

    body = [
        {"type": "text", "text": "新訂單", "weight": "bold", "size": "sm",
         "color": "#c8952b"},
        {"type": "text", "text": f"NT${int(float(order.total_amount or 0)):,}",
         "weight": "bold", "size": "xxl", "margin": "sm"},
        {"type": "separator", "margin": "lg"},
        {
            "type": "box", "layout": "vertical", "margin": "lg", "spacing": "sm",
            "contents": [
                _row("訂單編號", order.order_no),
                _row("收件人", f"{order.receiver_name}　{order.receiver_phone or ''}"),
                _row("商品", items),
                _row("送貨", f"{order.shipping_method_label or ''}　{ship_to}"),
                _row("付款", f"{order.payment_method_label or ''}"
                             f"（{'已付款' if paid else '尚未付款'}）"),
            ],
        },
    ]

    # 已經建過單就不要再給按鈕，改成直接顯示寄件代碼
    if order.allpay_logistics_id:
        footer = [
            {"type": "text", "text": "已建立物流單", "size": "sm", "color": "#6d6053",
             "align": "center"},
            {"type": "text", "text": order.cvs_payment_no or order.allpay_logistics_id,
             "weight": "bold", "size": "xl", "align": "center", "margin": "sm"},
        ]
    else:
        footer = [{
            "type": "button", "style": "primary", "color": "#c8952b", "height": "sm",
            "action": {
                "type": "postback",
                "label": "建立物流單",
                "data": f"act=ship&order={order.id}",
                "displayText": f"建立物流單 {order.order_no}",
            },
        }]

    footer.append({
        "type": "button", "style": "link", "height": "sm",
        "action": {"type": "uri", "label": "打開後台",
                   "uri": f"{front_url.rstrip('/')}/admin/orders"},
    })

    return {
        "type": "flex",
        "altText": f"新訂單 {order.order_no}　NT${int(float(order.total_amount or 0)):,}",
        "contents": {
            "type": "bubble",
            "body": {"type": "box", "layout": "vertical", "contents": body},
            "footer": {"type": "box", "layout": "vertical", "spacing": "sm",
                       "contents": footer},
        },
    }


def shipping_code_card(order: Order, result: dict[str, Any]) -> dict:
    """建單成功後回傳寄件代碼。

    寄件代碼要**大而清楚** —— 這是要在超商機台上照著打的東西，
    站在店裡瞇著眼看小字很痛苦。
    """
    code = result.get("cvs_payment_no") or result.get("allpay_logistics_id") or "—"
    validation = result.get("cvs_validation_no")

    contents = [
        {"type": "text", "text": "建立成功", "weight": "bold", "size": "sm",
         "color": "#3f7d4f"},
        {"type": "text", "text": "寄件代碼（超商機台輸入）", "size": "xs",
         "color": "#9a8e7d", "margin": "md"},
        {"type": "text", "text": str(code), "weight": "bold", "size": "3xl",
         "margin": "sm", "wrap": True},
    ]
    if validation:
        contents += [
            {"type": "text", "text": "驗證碼", "size": "xs", "color": "#9a8e7d",
             "margin": "lg"},
            {"type": "text", "text": str(validation), "weight": "bold", "size": "xxl",
             "margin": "sm"},
        ]
    contents += [
        {"type": "separator", "margin": "lg"},
        _row("訂單", order.order_no),
        _row("門市", order.cvs_store_name or order.receiver_address or "—"),
        {"type": "text",
         "text": "把包裹拿到超商，在機台輸入寄件代碼列印單據，貼上後交給店員即可。",
         "size": "xs", "color": "#6d6053", "wrap": True, "margin": "lg"},
    ]

    return {
        "type": "flex",
        "altText": f"寄件代碼 {code}",
        "contents": {
            "type": "bubble",
            "body": {"type": "box", "layout": "vertical", "contents": contents},
        },
    }


def notify_new_order(order: Order, db) -> None:
    """訂單成立／收到款項時通知老闆。

    失敗只記錄不拋出 —— 通知送不出去是小事，讓客人結不了帳是大事。

    但**跳過的原因一定要寫進日誌**。之前是直接 return，
    於是「沒設定 token」「沒有人收」「LINE 掛掉」三種情況
    在外面看起來完全一樣，都是安靜的什麼都沒發生。
    """
    if not is_configured():
        log.info("略過 LINE 訂單通知：沒有設定 LINE_CHANNEL_ACCESS_TOKEN")
        return
    if not admin_ids(db):
        log.info("略過 LINE 訂單通知：還沒有人配對，"
                 "請到後台『網站設定 → LINE 通知機器人』取得配對碼")
        return
    try:
        push_to_admins([order_card(order, settings.FRONTEND_BASE_URL)], db)
    except Exception as exc:  # noqa: BLE001
        log.warning("LINE 訂單通知失敗：%s", exc)


# ---------------------------------------------------------------- 配對碼

PAIR_CODE_KEY = "line_pair_code"
PAIR_EXPIRES_KEY = "line_pair_expires"
PAIR_MINUTES = 10

"""為什麼要有配對碼

原本的做法是「在 LINE 傳『我的ID』→ 複製那串 33 個字元 → 貼進後台」。
那串長得像 `U4af4980629...`，用手機複製再切到電腦貼上，
少一個字、多一個空白就整個不會動，而且**錯了完全沒有提示** ——
只會表現成「怎麼都收不到通知」。

配對碼把方向反過來：後台產生六位數字，那個人在 LINE 打那六個字，
系統自己把他的 userId 記起來。不用複製、不會打錯、看得到成功訊息。

安全性：六位數字十分鐘內只能用一次，而且**產生配對碼要先登入後台**。
猜中的機率是百萬分之一，還要在十分鐘內猜到。
"""


def issue_pair_code(db) -> str:
    """產生一組配對碼。同時只會有一組有效 —— 舊的直接被蓋掉。"""
    import secrets as _secrets
    from datetime import datetime, timedelta

    code = f"{_secrets.randbelow(1000000):06d}"
    expires = datetime.now() + timedelta(minutes=PAIR_MINUTES)
    _save_setting(db, PAIR_CODE_KEY, code)
    _save_setting(db, PAIR_EXPIRES_KEY, expires.isoformat())
    db.commit()
    return code


def redeem_pair_code(db, code: str, user_id: str) -> tuple[bool, str]:
    """用配對碼把自己加進名單。回傳 (成功與否, 給使用者看的訊息)。"""
    import hmac as _hmac
    from datetime import datetime

    stored = _setting(db, PAIR_CODE_KEY).strip()
    raw_expires = _setting(db, PAIR_EXPIRES_KEY).strip()

    if not stored or not raw_expires:
        return False, "目前沒有有效的配對碼。請先到後台「網站設定 → LINE 通知機器人」按「產生配對碼」。"

    try:
        expires = datetime.fromisoformat(raw_expires)
    except ValueError:
        return False, "配對碼的資料壞了，請到後台重新產生一次。"

    if datetime.now() > expires:
        return False, f"這組配對碼已經過期（只有 {PAIR_MINUTES} 分鐘），請到後台重新產生。"

    # 用 compare_digest 而不是 == ：一般字串比較會在第一個不同的字元就回傳，
    # 理論上可以從回應時間反推。六位數字本來就好猜，不要再送出額外線索。
    if not _hmac.compare_digest(stored, code.strip()):
        return False, "配對碼不對，請確認後重新輸入。"

    added = add_admin(db, user_id)
    # 用過就作廢，不管有沒有真的加到人 —— 一組碼只能用一次
    _save_setting(db, PAIR_CODE_KEY, "")
    _save_setting(db, PAIR_EXPIRES_KEY, "")
    db.commit()

    if added:
        return True, "設定完成，之後有訂單就會通知你，也可以直接在這裡建立物流單。"
    return True, "你本來就已經在通知名單裡了。"
