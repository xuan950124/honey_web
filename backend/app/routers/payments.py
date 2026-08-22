"""綠界金流：信用卡 / ATM 虛擬帳號 / 超商代碼繳費。

安全性重點：卡號永遠不會經過我們的主機。
我們只是把訂單資訊 POST 到綠界的付款頁，買家在綠界的網域上輸入卡號，
我們再從綠界的通知得知付款結果。這是 PCI DSS 建議的做法。
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from html import escape

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import get_optional_user, require_staff
from .. import membership, refunds
from ..line import notify_new_order
from ..models import User
from .orders import _decorate, _restore_stock, can_view_order
from ..ecpay import (
    auto_submit_form, sanitize_goods_name, verify_check_mac_value, with_check_mac_value,
)
from ..models import (
    PAYMENT_MAP, EcpayLog, Order, OrderStatus, PaymentMethod, PaymentStatus,
)
from ..shipping import unpaid_expire_days

router = APIRouter(prefix="/api/payments", tags=["payments"])

log = logging.getLogger("honey")

# 綠界回傳的 RtnCode：1 代表成功；ATM/CVS 取號成功回 2、10100073 等
SUCCESS_CODES = {"1"}
TAKEN_NUMBER_CODES = {"2", "10100073"}


def _log(db: Session, kind: str, order_no: str | None, success: bool,
         message: str, payload: object) -> None:
    db.add(EcpayLog(
        kind=kind, order_no=order_no, success=success, message=(message or "")[:300],
        payload=json.dumps(payload, ensure_ascii=False, default=str)[:60000],
    ))


def next_trade_no(order: Order) -> str:
    """算出這次要送給綠界的 MerchantTradeNo。

    綠界規定 MerchantTradeNo 不可重複 —— 同一組編號送第二次會被退回
    「MerchantTradeNo is exist」。所以重新付款時要換一組編號：
    第一次用訂單編號本身，第二次以後加上 R2、R3…（上限 20 碼）。
    回呼時再從編號還原成訂單，見 _find_order。
    """
    attempt = int(order.payment_attempts or 0) + 1
    if attempt <= 1:
        return order.order_no[:20]
    suffix = f"R{attempt}"
    return f"{order.order_no[:20 - len(suffix)]}{suffix}"


def _find_order(db: Session, trade_no: str) -> Order | None:
    """從綠界回傳的 MerchantTradeNo 找回訂單（重新付款會帶 R2、R3 這種尾碼）。"""
    if not trade_no:
        return None
    order = db.query(Order).filter(Order.payment_trade_no == trade_no).first()
    if order:
        return order
    order = db.query(Order).filter(Order.order_no == trade_no).first()
    if order:
        return order
    # 舊的那次付款（例如買家最後還是去繳了第一次取的 ATM 帳號）
    base = re.sub(r"R\d+$", "", trade_no)
    if base and base != trade_no:
        return db.query(Order).filter(Order.order_no.like(f"{base}%")).first()
    return None


def _build_checkout_params(order: Order, trade_no: str) -> dict[str, object]:
    choose_payment = PAYMENT_MAP[order.payment_method.value][0]
    if not choose_payment:
        raise HTTPException(status_code=400, detail="貨到付款不需要線上付款")

    base = settings.BACKEND_BASE_URL.rstrip("/")
    front = settings.FRONTEND_BASE_URL.rstrip("/")

    # 品名以 # 分隔，綠界會逐行顯示
    item_name = "#".join(
        f"{sanitize_goods_name(i.product_name)} x{i.quantity}" for i in order.items
    ) or "蜂蜜商品"
    if order.shipping_fee and float(order.shipping_fee) > 0:
        item_name += f"#運費 x1"

    params: dict[str, object] = {
        "MerchantID": settings.ECPAY_MERCHANT_ID,
        "MerchantTradeNo": trade_no,
        # 用「現在」而不是下單時間：重新付款時送出幾天前的日期沒有意義，
        # 綠界的交易紀錄也會對不起來
        "MerchantTradeDate": datetime.now().strftime("%Y/%m/%d %H:%M:%S"),
        "PaymentType": "aio",
        "TotalAmount": int(round(float(order.total_amount))),
        "TradeDesc": "蜂蜜商品訂單",
        "ItemName": item_name[:400],
        "ReturnURL": f"{base}/api/payments/callback",
        "ClientBackURL": f"{front}/order/{order.order_no}?t={order.access_token or ''}",
        "OrderResultURL": f"{base}/api/payments/result",
        "ChoosePayment": choose_payment,
        "EncryptType": 1,
        "NeedExtraPaidInfo": "N",
    }

    if choose_payment == "ATM":
        params["ExpireDate"] = 3          # 繳費期限 3 天
    elif choose_payment == "CVS":
        params["StoreExpireDate"] = 4320  # 超商代碼繳費期限（分鐘）= 3 天
        params["Desc_1"] = "請持繳費代碼至超商機台列印繳費單"

    return params


def _payment_error_page(message: str, order_no: str) -> HTMLResponse:
    """付款前的檢查沒過時，回一頁看得懂的中文說明並附上回訂單頁的按鈕。

    這裡刻意不丟 HTTPException —— 買家是被瀏覽器整頁導過來的，
    看到 FastAPI 的 {"detail": "..."} JSON 只會不知所措。
    """
    front = settings.FRONTEND_BASE_URL.rstrip("/")
    back = f"{front}/order/{order_no}" if order_no else front
    return HTMLResponse(f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>無法前往付款</title><style>
 body {{ font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;
        background:#fdfaf3;color:#33291d;display:flex;align-items:center;
        justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center; }}
 .box {{ max-width:420px; }}
 h1 {{ font-size:20px;color:#7a5424;margin:0 0 12px; }}
 p {{ font-size:15px;line-height:1.7;color:#6d6053;margin:0 0 22px; }}
 a {{ display:inline-block;padding:11px 26px;background:#c8952b;color:#fff;
      border-radius:4px;text-decoration:none;font-size:15px; }}
</style></head>
<body><div class="box">
  <h1>無法前往付款</h1>
  <p>{escape(message)}</p>
  <a href="{escape(back)}">回到訂單頁</a>
</div></body></html>""", status_code=400)


@router.get("/{order_no}/checkout", response_class=HTMLResponse)
def checkout(
    order_no: str,
    t: str | None = Query(default=None, description="訂單存取碼"),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    """導向綠界付款頁。前端把瀏覽器整頁導到這個網址即可（不要用 iframe）。

    第二次以後進來就是「重新付款」：換一組 MerchantTradeNo 再送一次，
    訂單、折價券、庫存都不動。

    需要存取碼或本人登入 —— 沒有的話，任何人都能用猜到的訂單編號叫出
    別人訂單的付款頁，上面會顯示金額與商品明細。
    """
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order or not can_view_order(order, user, t):
        return _payment_error_page(
            "找不到這筆訂單，或這個付款連結已經失效。請回到會員中心的訂單列表重新進入。",
            order_no,
        )
    if order.payment_status == PaymentStatus.paid:
        return _payment_error_page("這筆訂單已經付款完成，不需要再付一次。", order_no)
    if order.payment_method == PaymentMethod.cod:
        return _payment_error_page("這筆訂單是貨到付款，取貨時付現即可。", order_no)
    if order.status == OrderStatus.cancelled:
        return _payment_error_page(
            f"這筆訂單已經取消{f'（{order.cancel_reason}）' if order.cancel_reason else ''}，"
            "無法付款。請重新下單，或與我們聯絡。",
            order_no,
        )

    days = unpaid_expire_days(db)
    if days > 0 and order.created_at + timedelta(days=days) < datetime.now():
        return _payment_error_page(
            f"這筆訂單已超過 {days} 天的付款期限。請重新下單，或與我們聯絡由我們協助處理。",
            order_no,
        )

    trade_no = next_trade_no(order)
    params = _build_checkout_params(order, trade_no)
    signed = with_check_mac_value(
        params, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    )

    order.payment_attempts = int(order.payment_attempts or 0) + 1
    order.payment_trade_no = trade_no
    # 換了新的交易編號，舊的虛擬帳號就作廢了，不要繼續顯示給買家
    if order.payment_attempts > 1:
        order.payment_no = None
        order.payment_bank_code = None
        order.payment_expire_date = None
        order.payment_status = PaymentStatus.unpaid
    _log(db, "payment_checkout", order.order_no, True,
         f"第 {order.payment_attempts} 次付款，交易編號 {trade_no}", params)
    db.commit()

    return HTMLResponse(auto_submit_form(
        f"{settings.ecpay_payment_host}/Cashier/AioCheckOut/V5",
        signed, title="前往付款", note="正在將您導向綠界付款頁…",
    ))


def _apply_payment_result(db: Session, order: Order, form: dict[str, str]) -> None:
    """把綠界回傳的付款結果寫進訂單。"""
    code = str(form.get("RtnCode", ""))
    order.ecpay_trade_no = form.get("TradeNo") or order.ecpay_trade_no
    order.payment_type = form.get("PaymentType") or order.payment_type

    if code in SUCCESS_CODES:
        order.payment_status = PaymentStatus.paid
        order.paid_at = datetime.now()
        order.payment_message = None
        if order.status == OrderStatus.pending:
            order.status = OrderStatus.paid
        # 付款完成才計入會員累積消費（內部有防重複計算的旗標）
        issued = membership.record_spending(db, order)
        # 錢確定進來了才通知老闆 —— 這時候才是真的可以出貨。
        # 通知失敗不會影響付款流程（notify_new_order 內部全部包起來了）。
        notify_new_order(_decorate(order), db)
        for coupon in issued:
            _log(db, "coupon_issued", order.order_no, True,
                 f"累積消費達標，發放折價券 {coupon.code}（{coupon.name}）", {})
    elif code in TAKEN_NUMBER_CODES:
        # ATM / 超商代碼取號成功，還沒真的付款
        order.payment_status = PaymentStatus.pending
        order.payment_no = (
            form.get("vAccount") or form.get("PaymentNo") or form.get("CodeNo") or order.payment_no
        )
        order.payment_bank_code = form.get("BankCode") or order.payment_bank_code
        order.payment_expire_date = form.get("ExpireDate") or order.payment_expire_date
        order.payment_message = None
    else:
        order.payment_status = PaymentStatus.failed
        # 綠界的訊息通常是「銀行拒絕授權」這類，直接給買家看比代碼有用
        order.payment_message = (form.get("RtnMsg") or f"付款失敗（代碼 {code}）")[:200]


@router.post("/callback", response_class=PlainTextResponse)
async def payment_callback(request: Request, db: Session = Depends(get_db)):
    """綠界付款結果通知（ReturnURL），伺服器對伺服器。必須回覆 1|OK。

    注意：這個網址必須是外部連得到的公開網址，且綠界只支援 80 / 443 埠。
    本機開發請用 ngrok 之類的工具，並把 BACKEND_BASE_URL 設成公開網址。
    """
    form = {k: str(v) for k, v in (await request.form()).items()}
    trade_no = form.get("MerchantTradeNo", "")

    if not verify_check_mac_value(
        form, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    ):
        _log(db, "payment_callback", trade_no, False, "檢查碼驗證失敗", form)
        db.commit()
        return PlainTextResponse("0|CheckMacValue Error")

    # SimulatePaid=1 代表是後台的「模擬付款」測試，不可改動訂單狀態
    if str(form.get("SimulatePaid", "0")) == "1":
        _log(db, "payment_callback", trade_no, True, "模擬付款測試，未變更訂單", form)
        db.commit()
        return PlainTextResponse("1|OK")

    order = _find_order(db, trade_no)
    if not order:
        _log(db, "payment_callback", trade_no, False, "找不到對應訂單", form)
        db.commit()
        return PlainTextResponse("1|OK")  # 仍回 OK，避免綠界不斷重送
    order_no = order.order_no

    # 金額必須相符，防止竄改
    try:
        paid_amount = int(float(form.get("TradeAmt", 0)))
    except (TypeError, ValueError):
        paid_amount = -1
    if paid_amount != int(round(float(order.total_amount))):
        _log(db, "payment_callback", order_no, False,
             f"金額不符：綠界 {paid_amount} / 訂單 {order.total_amount}", form)
        db.commit()
        return PlainTextResponse("0|Amount Mismatch")

    _apply_payment_result(db, order, form)
    _log(db, "payment_callback", order_no, True, form.get("RtnMsg", ""), form)
    db.commit()
    return PlainTextResponse("1|OK")


@router.post("/result")
async def payment_result(request: Request, db: Session = Depends(get_db)):
    """付款完成後綠界把「瀏覽器」導回這裡（OrderResultURL），再轉回前端訂單頁。

    **這條路徑不作為「付款成功」的依據。**

    它是經過使用者的瀏覽器回來的，內容原則上不可信。雖然我們有驗 CheckMacValue，
    但「金額有沒有真的入帳」這種事應該只由伺服器對伺服器的通知（ReturnURL）決定，
    或由我們主動去問綠界。少一條可以被操作的路徑，就少一種被鑽的可能。

    所以這裡只做兩件事：主動向綠界查一次真實狀態，然後把人導回訂單頁。
    """
    form = {k: str(v) for k, v in (await request.form()).items()}
    trade_no = form.get("MerchantTradeNo", "")
    order = _find_order(db, trade_no) if trade_no else None
    order_no = order.order_no if order else trade_no
    token = (order.access_token or "") if order else ""

    if order:
        _log(db, "payment_result", order_no, True,
             f"買家從綠界導回（僅記錄，不據此判定付款）：{form.get('RtnMsg', '')}", form)
        db.commit()

        # 主動去問綠界這筆到底付了沒。這是伺服器對伺服器，問到的才算數。
        if order.payment_status != PaymentStatus.paid:
            try:
                _query_and_apply(db, order)
            except Exception:  # noqa: BLE001 - 查不到就等 ReturnURL 通知，別擋住使用者
                log.warning("導回時向綠界查詢失敗，等待伺服器通知", exc_info=True)

    front = settings.FRONTEND_BASE_URL.rstrip("/")
    return RedirectResponse(url=f"{front}/order/{order_no}?t={token}", status_code=303)


def _query_and_apply(db: Session, order: Order) -> tuple[str, dict[str, str]]:
    """主動向綠界查這筆訂單的真實狀態，並寫回訂單。

    這是**伺服器對伺服器**的查詢，問到的結果才算數 ——
    跟瀏覽器帶回來的參數是完全不同層級的可信度。
    回傳 (TradeStatus, 綠界回的整包資料)。
    """
    # 查最後一次真的送出去的交易編號（重新付款過的話會是 R2、R3 那組）
    params = {
        "MerchantID": settings.ECPAY_MERCHANT_ID,
        "MerchantTradeNo": order.payment_trade_no or order.order_no[:20],
        "TimeStamp": int(datetime.now().timestamp()),
    }
    signed = with_check_mac_value(
        params, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    )

    url = f"{settings.ecpay_payment_host}/Cashier/QueryTradeInfo/V5"
    try:
        resp = httpx.post(url, data=signed, timeout=30.0)
        resp.raise_for_status()
        body = resp.text
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"無法連線到綠界：{exc}") from exc

    data: dict[str, str] = {}
    for pair in body.strip().split("&"):
        if "=" in pair:
            k, _, v = pair.partition("=")
            data[k] = v

    if not data or "TradeStatus" not in data:
        _log(db, "payment_query", order.order_no, False, body[:200], body)
        db.commit()
        raise HTTPException(status_code=400, detail=f"綠界回應無法解析：{body[:200]}")

    trade_status = data.get("TradeStatus", "")
    order.ecpay_trade_no = data.get("TradeNo") or order.ecpay_trade_no
    order.payment_type = data.get("PaymentType") or order.payment_type

    if trade_status == "1":
        # 金額也要對得上，避免查到的是別筆或金額被動過
        try:
            paid = int(float(data.get("TradeAmt", 0)))
        except (TypeError, ValueError):
            paid = -1
        if paid != int(round(float(order.total_amount))):
            _log(db, "payment_query", order.order_no, False,
                 f"金額不符：綠界 {paid} / 訂單 {order.total_amount}", data)
            db.commit()
            raise HTTPException(status_code=400, detail="綠界回報的金額與訂單不符，請人工確認")
        order.payment_status = PaymentStatus.paid
        order.paid_at = order.paid_at or datetime.now()
        order.payment_message = None
        if order.status == OrderStatus.pending:
            order.status = OrderStatus.paid
        membership.record_spending(db, order)
    elif trade_status == "0":
        order.payment_status = PaymentStatus.unpaid
    elif trade_status == "10":
        order.payment_status = PaymentStatus.pending

    _log(db, "payment_query", order.order_no, True, f"TradeStatus={trade_status}", data)
    db.commit()
    return trade_status, data


@router.post("/{order_no}/sync", dependencies=[Depends(require_staff)])
def sync_payment_status(order_no: str, db: Session = Depends(get_db)):
    """主動向綠界查詢訂單付款狀態。

    當 ReturnURL 收不到通知時（例如本機開發沒有公開網址），
    工作人員可以用這個功能手動把付款狀態補回來。
    """
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")

    trade_status, data = _query_and_apply(db, order)
    db.refresh(order)

    return {
        "ok": True,
        "payment_status": order.payment_status.value,
        "trade_status": trade_status,
        "trade_no": order.ecpay_trade_no,
        "message": data.get("TradeStatus_Msg") or data.get("RtnMsg") or "",
    }


@router.post("/{order_no}/mark-paid", dependencies=[Depends(require_staff)])
def mark_paid(order_no: str, db: Session = Depends(get_db)):
    """工作人員手動註記「已收到款項」。

    用在綠界以外的收款：買家直接匯款、面交付現、或綠界通知漏掉而查詢也查不到。
    會照正常流程計入會員累積消費並發券，跟線上付款成功一模一樣。
    """
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")
    if order.payment_status == PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="這筆訂單已經是已付款狀態")

    order.payment_status = PaymentStatus.paid
    order.paid_at = order.paid_at or datetime.now()
    order.payment_message = None
    if order.status in (OrderStatus.pending, OrderStatus.cancelled):
        order.status = OrderStatus.paid
    issued = membership.record_spending(db, order)
    notify_new_order(_decorate(order), db)

    _log(db, "payment_manual", order_no, True, "工作人員手動註記已收款", {})
    db.commit()

    extra = f"，並發放 {len(issued)} 張折價券" if issued else ""
    return {"ok": True, "message": f"已註記為已付款{extra}。", "payment_status": "paid"}


# ---------------------------------------------------------------- 退款

@router.get("/{order_no}/refund-plan", dependencies=[Depends(require_staff)])
def refund_plan(order_no: str, db: Session = Depends(get_db)):
    """這一筆該怎麼退。只回說明，不動任何東西。

    刻意做成獨立的端點：後台展開訂單就先看得到步驟，
    不必按了才知道「喔原來 ATM 不能用 API 退」。
    """
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")

    plan = refunds.refund_plan(order)
    return {
        **plan,
        "order_no": order.order_no,
        "trade_no": order.ecpay_trade_no,
        "total_amount": float(order.total_amount or 0),
        "refunded_amount": float(order.refunded_amount or 0),
        "payment_method": order.payment_method.value if order.payment_method else None,
        "payment_status": order.payment_status.value,
        "paid_at": order.paid_at,
        "vendor_url": refunds.VENDOR_URL,
    }


@router.post("/{order_no}/refund", dependencies=[Depends(require_staff)])
def do_refund(order_no: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    """執行退款。

    ## 為什麼要重打一次金額

    這是整個後台唯一一個「按下去錢就出去、而且收不回來」的操作。
    再問一次「你確定嗎」的對話框沒有用 —— 那種框大家都是直接按確定。
    要求把金額打進來，才會逼人真的看一眼自己在退多少。

    `mode`：
      - `api`    → 呼叫綠界的信用卡退款（只有信用卡可以）
      - `manual` → 你已經在綠界後台按完了，或是自己匯款了，回來做紀錄
    """
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")

    mode = str(payload.get("mode") or "manual").strip()
    note = str(payload.get("note") or "").strip()
    remaining = refunds.refundable_amount(order)
    if remaining <= 0:
        raise HTTPException(status_code=400, detail="這筆訂單沒有可退的金額")

    try:
        amount = float(payload.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="請填寫退款金額") from None
    if amount <= 0:
        raise HTTPException(status_code=400, detail="退款金額要大於 0")
    if amount > remaining + 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"退款金額不能超過可退餘額 NT${remaining:,.0f}",
        )

    if mode == "api":
        plan = refunds.refund_plan(order)
        if not plan.get("can_use_api"):
            raise HTTPException(status_code=400, detail=plan.get("title") or "這筆不能用 API 退款")
        ok, message = refunds.call_ecpay_refund(
            db, order, int(round(amount)), plan["action"]
        )
        if not ok:
            db.commit()   # 保留失敗紀錄
            raise HTTPException(
                status_code=400,
                detail=f"綠界拒絕了這次退款：{message}　"
                       f"可以改到綠界後台手動處理，完成後回來按「標記為已退款」。",
            )
    elif mode != "manual":
        raise HTTPException(status_code=400, detail="不認得的退款方式")

    refunds.apply_refund(order, amount, mode, note)

    # 全額退款 = 這筆生意沒有成立：庫存要還、累積消費要扣回去
    fully = refunds.refundable_amount(order) <= 0
    if fully:
        membership.revoke_spending(db, order)
        if order.status != OrderStatus.cancelled:
            order.status = OrderStatus.cancelled
        _restore_stock(db, order)

    _log(db, "payment_refund", order_no, True,
         f"{mode} 退款 {amount}（累計 {order.refunded_amount}）", {"note": note})
    db.commit()

    return {
        "ok": True,
        "refunded_amount": float(order.refunded_amount or 0),
        "remaining": refunds.refundable_amount(order),
        "payment_status": order.payment_status.value,
        "status": order.status.value,
        "message": (
            f"已記錄退款 NT${amount:,.0f}。"
            + ("這筆已全額退款，訂單改為已取消、庫存已還原。" if fully else "")
        ),
    }
