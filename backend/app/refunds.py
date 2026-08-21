"""退款：判斷該怎麼退，以及呼叫綠界的退款 API。

## 為什麼要分成「怎麼退」與「真的退」兩件事

退款是**唯一一個按錯就把錢送出去、而且收不回來**的操作。
所以這裡刻意分層：

- `refund_plan()` 只**說明**這一筆該怎麼退（純函式，不碰網路也不碰資料庫）
- `call_ecpay_refund()` 才真的送出去

實務上絕大多數的退款都不需要走 API —— 綠界後台按兩下就好，
而且 ATM 與超商代碼**本來就沒有退款 API**，只能自己匯款。
把「怎麼做」講清楚，比多一顆按鈕有用得多。

## 綠界信用卡退款的規則

| 時間點 | 動作 | 綠界的 Action | 客人看到什麼 |
|---|---|---|---|
| 當天（尚未請款）| 取消授權 | `N`（放棄請款）| 帳單上不會出現這筆 |
| 隔天之後（已請款）| 退刷 | `R` | 先一筆扣款，再一筆退款 |

「當天」的界線是綠界的每日請款批次（約凌晨），不是 24 小時。
所以這裡用「付款日期是不是今天」來判斷，並且**兩種都試**：
先照建議的動作送，被拒絕就換另一種再送一次 ——
時區或批次時間差幾分鐘的情況真的會發生，讓使用者自己猜是最糟的設計。
"""
from __future__ import annotations

from datetime import date, datetime

import httpx
from sqlalchemy.orm import Session

from .config import settings
from .ecpay import with_check_mac_value
from .models import EcpayLog, Order, PaymentMethod, PaymentStatus

# 綠界信用卡退款的動作代碼
ACTION_ABANDON = "N"   # 放棄請款（當天、尚未請款）
ACTION_REFUND = "R"    # 退刷（已請款）

# 這些付款方式綠界沒有退款 API，只能自己匯款回去
NO_API_METHODS = {
    PaymentMethod.atm.value,
    PaymentMethod.cvs_code.value,
    PaymentMethod.cod.value,
}

VENDOR_URL = "https://vendor.ecpay.com.tw/"


def refundable_amount(order: Order) -> float:
    """還可以退多少。"""
    paid = float(order.total_amount or 0)
    done = float(order.refunded_amount or 0)
    return max(0.0, round(paid - done, 2))


def suggested_action(order: Order, today: date | None = None) -> str:
    """今天付的就取消授權，之前付的就退刷。"""
    today = today or date.today()
    paid_on = order.paid_at.date() if order.paid_at else None
    return ACTION_ABANDON if paid_on == today else ACTION_REFUND


def refund_plan(order: Order, today: date | None = None) -> dict:
    """這一筆該怎麼退。**不會**動到任何東西，純粹產生說明。

    回傳的東西直接給後台畫面用：
      - `can_use_api`：能不能按那顆一鍵退款
      - `steps`：不能（或不想）用 API 時，去綠界後台要按什麼
    """
    method = order.payment_method.value if order.payment_method else ""
    remaining = refundable_amount(order)
    paid = order.payment_status == PaymentStatus.paid
    action = suggested_action(order, today)

    if not paid:
        return {
            "can_use_api": False,
            "title": "這筆還沒收到錢，不用退款",
            "remaining": remaining,
            "steps": [
                "訂單的付款狀態不是「已付款」，代表錢沒有進來過。",
                "直接把訂單改成「已取消」即可，庫存會自動還原。",
            ],
        }

    if remaining <= 0:
        return {
            "can_use_api": False,
            "title": "這筆已經全額退款了",
            "remaining": 0.0,
            "steps": [f"已退 NT${float(order.refunded_amount or 0):,.0f}，沒有可退的餘額。"],
        }

    if method == PaymentMethod.cod.value:
        return {
            "can_use_api": False,
            "title": "貨到付款：錢還在綠界，不是刷卡退款",
            "remaining": remaining,
            "steps": [
                "貨到付款的錢是**綠界代收**的，還沒撥給你之前不需要「退刷」。",
                "包裹還沒被取走 → 讓它逾期退回即可，代收金額不會產生。",
                "已經取貨了 → 錢會照常撥款給你，退款要**自己匯回買家帳戶**，"
                "請跟買家要匯款帳號。",
                "處理完回來按「標記為已退款」，庫存與累積消費會一起還原。",
            ],
        }

    if method in NO_API_METHODS:
        label = "ATM 轉帳" if method == PaymentMethod.atm.value else "超商代碼繳費"
        return {
            "can_use_api": False,
            "title": f"{label}：綠界沒有退款 API，要自己匯款",
            "remaining": remaining,
            "steps": [
                f"{label}的款項綠界**不提供 API 退款**，也不能在後台按退刷。",
                "請跟買家要銀行代碼、帳號與戶名，自己匯款回去。",
                "匯款手續費原則上由本店吸收（是我們這邊要退錢）。",
                "匯完回來按「標記為已退款」，並在備註寫下匯款日期與後五碼，方便日後對帳。",
            ],
        }

    # 信用卡
    if action == ACTION_ABANDON:
        return {
            "can_use_api": True,
            "action": ACTION_ABANDON,
            "action_label": "取消授權（放棄請款）",
            "remaining": remaining,
            "title": "信用卡．今天剛付的 → 取消授權",
            "steps": [
                "這筆是**今天**付款的，綠界還沒請款，所以走「取消授權」。",
                "取消之後買家的帳單上**不會出現這筆消費**，也不會佔用額度，最乾淨。",
                "可以直接按下面的「向綠界送出退款」，或到綠界後台 → "
                "信用卡收單 → 交易明細查詢 → 找到這筆 → 放棄請款。",
                "注意：綠界每天凌晨會跑請款批次，過了就只能改走退刷。",
            ],
        }

    return {
        "can_use_api": True,
        "action": ACTION_REFUND,
        "action_label": "退刷",
        "remaining": remaining,
        "title": "信用卡．已請款 → 退刷",
        "steps": [
            "這筆已經過了請款批次，只能走「退刷」。",
            "買家的帳單會**先出現一筆扣款、之後再出現一筆退款**，"
            "依發卡銀行作業時間通常 7～14 個工作天，這點要先跟買家講。",
            "可以直接按下面的「向綠界送出退款」，或到綠界後台 → "
            "信用卡收單 → 交易明細查詢 → 找到這筆 → 退刷。",
            "刷卡手續費通常不退還，那是綠界收的。",
        ],
    }


def _log(db: Session, order_no: str, success: bool, message: str, payload: object) -> None:
    db.add(EcpayLog(
        kind="payment_refund", order_no=order_no, success=success,
        message=message[:500], payload=str(payload)[:4000],
    ))


def call_ecpay_refund(db: Session, order: Order, amount: int, action: str) -> tuple[bool, str]:
    """真的向綠界送出退款。回傳 (成功與否, 訊息)。

    ## 為什麼失敗時會換一個動作再試一次

    「當天 vs 隔天」的界線是綠界的請款批次時間，不是午夜零點。
    差幾分鐘就會出現「你以為還沒請款、其實已經請款了」的情況，
    而綠界只會回一句看不懂的錯誤碼。

    與其讓使用者自己猜，不如自動換另一個動作再送一次 ——
    兩個動作是互斥的（要嘛還沒請款、要嘛已請款），不會重複退到錢。
    """
    if not order.ecpay_trade_no:
        return False, "這筆訂單沒有綠界交易編號，無法用 API 退款。請到綠界後台手動處理。"

    tried: list[str] = []
    for attempt in (action, ACTION_REFUND if action == ACTION_ABANDON else ACTION_ABANDON):
        if attempt in tried:
            continue
        tried.append(attempt)
        ok, message = _send(db, order, amount, attempt)
        if ok:
            return True, message
        last = message

    return False, last


def _send(db: Session, order: Order, amount: int, action: str) -> tuple[bool, str]:
    params = {
        "MerchantID": settings.ECPAY_MERCHANT_ID,
        "MerchantTradeNo": order.payment_trade_no or order.order_no[:20],
        "TradeNo": order.ecpay_trade_no or "",
        "Action": action,
        "TotalAmount": int(amount),
    }
    signed = with_check_mac_value(
        params, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    )

    url = f"{settings.ecpay_payment_host}/CreditDetail/DoAction"
    try:
        resp = httpx.post(url, data=signed, timeout=30.0)
        resp.raise_for_status()
        body = resp.text
    except httpx.HTTPError as exc:
        _log(db, order.order_no, False, f"連線失敗：{exc}", params)
        return False, f"無法連線到綠界：{exc}"

    data: dict[str, str] = {}
    for pair in body.strip().split("&"):
        if "=" in pair:
            k, _, v = pair.partition("=")
            data[k] = v

    # 綠界回 RtnCode=1 才是成功
    if data.get("RtnCode") == "1":
        _log(db, order.order_no, True, f"Action={action} 金額={amount}", data)
        return True, data.get("RtnMsg") or "退款成功"

    reason = data.get("RtnMsg") or body[:200]
    _log(db, order.order_no, False, f"Action={action}：{reason}", data or body)
    return False, reason


def apply_refund(order: Order, amount: float, method: str, note: str = "") -> None:
    """把退款記到訂單上。

    退**滿**了才改成 refunded；部分退款維持已付款，
    不然報表會把一筆只退了運費的訂單當成整筆沒收到錢。
    """
    order.refunded_amount = round(float(order.refunded_amount or 0) + float(amount), 2)
    order.refunded_at = datetime.now()
    order.refund_method = method
    if note:
        order.refund_note = note[:300]
    if refundable_amount(order) <= 0:
        order.payment_status = PaymentStatus.refunded
