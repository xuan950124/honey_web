"""綠界金流：信用卡 / ATM 虛擬帳號 / 超商代碼繳費。

安全性重點：卡號永遠不會經過我們的主機。
我們只是把訂單資訊 POST 到綠界的付款頁，買家在綠界的網域上輸入卡號，
我們再從綠界的通知得知付款結果。這是 PCI DSS 建議的做法。
"""
from __future__ import annotations

import json
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, RedirectResponse
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import require_staff
from ..ecpay import (
    auto_submit_form, sanitize_goods_name, verify_check_mac_value, with_check_mac_value,
)
from ..models import (
    PAYMENT_MAP, EcpayLog, Order, OrderStatus, PaymentMethod, PaymentStatus,
)

router = APIRouter(prefix="/api/payments", tags=["payments"])

# 綠界回傳的 RtnCode：1 代表成功；ATM/CVS 取號成功回 2、10100073 等
SUCCESS_CODES = {"1"}
TAKEN_NUMBER_CODES = {"2", "10100073"}


def _log(db: Session, kind: str, order_no: str | None, success: bool,
         message: str, payload: object) -> None:
    db.add(EcpayLog(
        kind=kind, order_no=order_no, success=success, message=(message or "")[:300],
        payload=json.dumps(payload, ensure_ascii=False, default=str)[:60000],
    ))


def _build_checkout_params(order: Order) -> dict[str, object]:
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
        "MerchantTradeNo": order.order_no[:20],
        "MerchantTradeDate": order.created_at.strftime("%Y/%m/%d %H:%M:%S"),
        "PaymentType": "aio",
        "TotalAmount": int(round(float(order.total_amount))),
        "TradeDesc": "蜂蜜商品訂單",
        "ItemName": item_name[:400],
        "ReturnURL": f"{base}/api/payments/callback",
        "ClientBackURL": f"{front}/order/{order.order_no}",
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


@router.get("/{order_no}/checkout", response_class=HTMLResponse)
def checkout(order_no: str, db: Session = Depends(get_db)):
    """導向綠界付款頁。前端把瀏覽器整頁導到這個網址即可（不要用 iframe）。"""
    order = (
        db.query(Order).options(joinedload(Order.items))
        .filter(Order.order_no == order_no).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")
    if order.payment_status == PaymentStatus.paid:
        raise HTTPException(status_code=400, detail="這筆訂單已經付款完成")
    if order.payment_method == PaymentMethod.cod:
        raise HTTPException(status_code=400, detail="貨到付款不需要線上付款")

    params = _build_checkout_params(order)
    signed = with_check_mac_value(
        params, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    )
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
        if order.status == OrderStatus.pending:
            order.status = OrderStatus.paid
    elif code in TAKEN_NUMBER_CODES:
        # ATM / 超商代碼取號成功，還沒真的付款
        order.payment_status = PaymentStatus.pending
        order.payment_no = (
            form.get("vAccount") or form.get("PaymentNo") or form.get("CodeNo") or order.payment_no
        )
        order.payment_bank_code = form.get("BankCode") or order.payment_bank_code
        order.payment_expire_date = form.get("ExpireDate") or order.payment_expire_date
    else:
        order.payment_status = PaymentStatus.failed


@router.post("/callback", response_class=PlainTextResponse)
async def payment_callback(request: Request, db: Session = Depends(get_db)):
    """綠界付款結果通知（ReturnURL），伺服器對伺服器。必須回覆 1|OK。

    注意：這個網址必須是外部連得到的公開網址，且綠界只支援 80 / 443 埠。
    本機開發請用 ngrok 之類的工具，並把 BACKEND_BASE_URL 設成公開網址。
    """
    form = {k: str(v) for k, v in (await request.form()).items()}
    order_no = form.get("MerchantTradeNo", "")

    if not verify_check_mac_value(
        form, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    ):
        _log(db, "payment_callback", order_no, False, "檢查碼驗證失敗", form)
        db.commit()
        return PlainTextResponse("0|CheckMacValue Error")

    # SimulatePaid=1 代表是後台的「模擬付款」測試，不可改動訂單狀態
    if str(form.get("SimulatePaid", "0")) == "1":
        _log(db, "payment_callback", order_no, True, "模擬付款測試，未變更訂單", form)
        db.commit()
        return PlainTextResponse("1|OK")

    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        _log(db, "payment_callback", order_no, False, "找不到對應訂單", form)
        db.commit()
        return PlainTextResponse("1|OK")  # 仍回 OK，避免綠界不斷重送

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
    """付款完成後綠界把「瀏覽器」導回這裡（OrderResultURL），再轉回前端訂單頁。"""
    form = {k: str(v) for k, v in (await request.form()).items()}
    order_no = form.get("MerchantTradeNo", "")

    if verify_check_mac_value(
        form, settings.ECPAY_HASH_KEY, settings.ECPAY_HASH_IV, algorithm="sha256"
    ):
        order = db.query(Order).filter(Order.order_no == order_no).first()
        if order and order.payment_status != PaymentStatus.paid:
            _apply_payment_result(db, order, form)
            _log(db, "payment_result", order_no, True, form.get("RtnMsg", ""), form)
            db.commit()

    front = settings.FRONTEND_BASE_URL.rstrip("/")
    return RedirectResponse(url=f"{front}/order/{order_no}", status_code=303)


@router.post("/{order_no}/sync", dependencies=[Depends(require_staff)])
def sync_payment_status(order_no: str, db: Session = Depends(get_db)):
    """主動向綠界查詢訂單付款狀態。

    當 ReturnURL 收不到通知時（例如本機開發沒有公開網址），
    工作人員可以用這個功能手動把付款狀態補回來。
    """
    order = db.query(Order).filter(Order.order_no == order_no).first()
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")

    params = {
        "MerchantID": settings.ECPAY_MERCHANT_ID,
        "MerchantTradeNo": order.order_no[:20],
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
        _log(db, "payment_query", order_no, False, body[:200], body)
        db.commit()
        raise HTTPException(status_code=400, detail=f"綠界回應無法解析：{body[:200]}")

    trade_status = data.get("TradeStatus", "")
    order.ecpay_trade_no = data.get("TradeNo") or order.ecpay_trade_no
    order.payment_type = data.get("PaymentType") or order.payment_type

    if trade_status == "1":
        order.payment_status = PaymentStatus.paid
        order.paid_at = order.paid_at or datetime.now()
        if order.status == OrderStatus.pending:
            order.status = OrderStatus.paid
    elif trade_status == "0":
        order.payment_status = PaymentStatus.unpaid
    elif trade_status == "10":
        order.payment_status = PaymentStatus.pending

    _log(db, "payment_query", order_no, True, f"TradeStatus={trade_status}", data)
    db.commit()
    db.refresh(order)

    return {
        "ok": True,
        "payment_status": order.payment_status.value,
        "trade_status": trade_status,
        "trade_no": order.ecpay_trade_no,
        "message": data.get("TradeStatus_Msg") or data.get("RtnMsg") or "",
    }
