"""綠界物流：門市電子地圖、建立物流訂單、狀態通知、列印託運單。

流程（C2C 店到店）：
  1. 買家結帳時點「選擇門市」→ 開新視窗到 /api/logistics/map
  2. 綠界電子地圖讓買家挑門市 → POST 回 /api/logistics/map/callback
  3. 回呼頁把門市資料用 postMessage 傳回原視窗並自動關閉
  4. 訂單成立、款項確認後，工作人員在後台按「建立物流單」
     → 後端呼叫綠界 /Express/Create → 取得寄件代碼 CVSPaymentNo
  5. 把包裹拿到超商機台輸入寄件代碼列印單據即可寄件
"""
from __future__ import annotations

import json
from datetime import datetime
from html import escape

import httpx
from fastapi import APIRouter, Depends, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from sqlalchemy.orm import Session, joinedload

from ..config import settings
from ..database import get_db
from ..deps import require_staff
from ..ecpay import (
    auto_submit_form, parse_backend_response, sanitize_cellphone, sanitize_goods_name,
    sanitize_name, sanitize_phone, verify_check_mac_value, with_check_mac_value,
)
from ..models import (
    SHIPPING_MAP, EcpayLog, LogisticsStatus, Order, OrderStatus, PaymentMethod,
    ShippingMethod, Temperature,
)
from ..shipping import get_shipping_settings

router = APIRouter(prefix="/api/logistics", tags=["logistics"])

# 綠界物流狀態代碼 -> 我們的狀態
# 完整代碼表：https://developers.ecpay.com.tw/?p=7440
STATUS_MAP: dict[str, LogisticsStatus] = {
    "300": LogisticsStatus.created,   # 訂單建立成功
    "310": LogisticsStatus.created,
    "2001": LogisticsStatus.created,  # 訂單成立（統一）
    "2030": LogisticsStatus.shipped,  # 商品已寄件
    "2063": LogisticsStatus.arrived,  # 商品已到店
    "2067": LogisticsStatus.picked,   # 消費者已取貨
    "2073": LogisticsStatus.returned,
    "3001": LogisticsStatus.created,  # 全家：訂單成立
    "3024": LogisticsStatus.shipped,
    "3018": LogisticsStatus.arrived,
    "3022": LogisticsStatus.picked,
    "3032": LogisticsStatus.returned,
    "5001": LogisticsStatus.created,  # 宅配：訂單成立
    "3006": LogisticsStatus.shipped,
    "5002": LogisticsStatus.shipped,
    "5013": LogisticsStatus.picked,
}


def _log(db: Session, kind: str, order_no: str | None, success: bool,
         message: str, payload: object) -> None:
    db.add(EcpayLog(
        kind=kind, order_no=order_no, success=success, message=(message or "")[:300],
        payload=json.dumps(payload, ensure_ascii=False, default=str)[:60000],
    ))


# ------------------------------------------------------------------ 電子地圖

@router.get("/map", response_class=HTMLResponse)
def open_store_map(shipping_method: str = ShippingMethod.cvs_unimart_c2c.value,
                   is_collection: str = "N"):
    """導轉到綠界的超商電子地圖讓買家選擇門市。

    注意：綠界明確要求不可用 iframe 嵌入，前端請用 window.open 開新視窗。
    測試環境不會真的跳出地圖，而是直接回傳一間固定的測試門市。
    """
    mapping = SHIPPING_MAP.get(shipping_method)
    if not mapping or mapping[0] != "CVS":
        raise HTTPException(status_code=400, detail="這個送貨方式不需要選擇門市")

    _, sub_type, _, _ = mapping
    merchant_id, _, _ = settings.logistics_credentials("CVS")

    params = {
        "MerchantID": merchant_id,
        "MerchantTradeNo": datetime.now().strftime("MAP%Y%m%d%H%M%S"),
        "LogisticsType": "CVS",
        "LogisticsSubType": sub_type,
        "IsCollection": "Y" if is_collection == "Y" else "N",
        "ServerReplyURL": f"{settings.BACKEND_BASE_URL.rstrip('/')}/api/logistics/map/callback",
        "ExtraData": "",
        "Device": 0,
    }
    return HTMLResponse(auto_submit_form(
        f"{settings.ecpay_logistics_host}/Express/map",
        params,
        title="選擇取貨門市",
        note="正在開啟超商門市地圖…",
    ))


@router.post("/map/callback", response_class=HTMLResponse)
async def store_map_callback(request: Request):
    """綠界電子地圖選完門市後，會用瀏覽器 POST 把門市資料送到這裡。

    這裡回一頁 HTML，把門市資訊用 postMessage 傳回開啟它的結帳頁，然後自動關閉視窗。
    """
    form = dict(await request.form())
    store = {
        "storeId": str(form.get("CVSStoreID", "") or ""),
        "storeName": str(form.get("CVSStoreName", "") or ""),
        "address": str(form.get("CVSAddress", "") or ""),
        "telephone": str(form.get("CVSTelephone", "") or ""),
        "outside": str(form.get("CVSOutSide", "") or ""),
        "subType": str(form.get("LogisticsSubType", "") or ""),
    }
    payload = json.dumps(store, ensure_ascii=False)
    origin = settings.FRONTEND_BASE_URL.rstrip("/")

    return HTMLResponse(f"""<!doctype html>
<html lang="zh-Hant">
<head><meta charset="utf-8" /><title>門市選擇完成</title>
<style>
 body {{ font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",sans-serif;
        background:#fdfaf3;color:#33291d;display:flex;align-items:center;
        justify-content:center;height:100vh;margin:0;text-align:center; }}
 .name {{ font-size:19px;color:#7a5424;margin-bottom:6px; }}
 .addr {{ font-size:14px;color:#6d6053; }}
 .hint {{ font-size:13px;color:#a5967f;margin-top:18px; }}
 button {{ margin-top:16px;padding:10px 24px;background:#c8952b;color:#fff;
           border:none;border-radius:4px;font-size:15px;cursor:pointer; }}
</style></head>
<body>
  <div>
    <div class="name">{escape(store['storeName'] or '已選擇門市')}</div>
    <div class="addr">{escape(store['address'])}</div>
    <div class="hint">視窗即將自動關閉…</div>
    <button onclick="send()">回到結帳頁</button>
  </div>
<script>
  var store = {payload};
  function send() {{
    try {{
      if (window.opener && !window.opener.closed) {{
        window.opener.postMessage({{ type: 'ecpay-store-selected', store: store }}, '{origin}');
        window.close();
        return;
      }}
    }} catch (e) {{}}
    // 沒有 opener（例如在同一分頁開啟）就帶參數導回結帳頁
    var q = new URLSearchParams(store).toString();
    location.replace('{origin}/cart?' + q);
  }}
  setTimeout(send, 700);
</script>
</body></html>""")


# ------------------------------------------------------------------ 建立物流訂單

# 這些超商子類型，綠界規定寄件人手機為必填
CELLPHONE_REQUIRED_SUBTYPES = {"UNIMARTC2C", "HILIFEC2C", "OKMARTC2C"}

SETTINGS_HINT = "請到「後台管理 → 網站設定 → 寄件人資訊」補齊："


def _check_sender(cfg: dict, logistics_type: str, sub_type: str) -> None:
    """送出前先檢查寄件人資料，把綠界的英文欄位名翻成看得懂的指示。

    綠界的規則（見 https://developers.ecpay.com.tw/?p=8809 與 ?p=7414）：
      - 寄件人姓名：一律必填
      - 7-ELEVEN／萊爾富／OK 店到店：寄件人手機必填
      - 宅配：手機與市話擇一，且郵遞區號與地址必填
    """
    problems: list[str] = []

    raw_name = (cfg.get("sender_name") or "").strip()
    if not raw_name:
        problems.append("寄件人姓名")
    elif not sanitize_name(raw_name, fallback=""):
        problems.append("寄件人姓名（不可只有數字或符號，需 2~5 個中文字）")

    raw_cell = (cfg.get("sender_cellphone") or "").strip()
    cell = sanitize_cellphone(raw_cell)
    phone = sanitize_phone((cfg.get("sender_phone") or "").strip())

    def cell_problem() -> str:
        if raw_cell and not cell:
            return f"寄件人手機格式不對（目前是「{raw_cell}」，需 09 開頭共 10 碼數字）"
        return "寄件人手機（09 開頭共 10 碼）"

    if logistics_type == "CVS":
        if sub_type in CELLPHONE_REQUIRED_SUBTYPES and not cell:
            problems.append(cell_problem())
    else:
        if not cell and not phone:
            problems.append("寄件人手機或市話（至少填一個）")
        elif raw_cell and not cell and not phone:
            problems.append(cell_problem())
        if not (cfg.get("sender_zipcode") or "").strip():
            problems.append("寄件人郵遞區號")
        if len((cfg.get("sender_address") or "").strip()) < 6:
            problems.append("寄件人地址（需完整且超過 6 個字）")

    if problems:
        raise HTTPException(status_code=400, detail=SETTINGS_HINT + "、".join(problems))


# 綠界建單失敗的常見原因，翻成「看得懂而且知道下一步」的說明。
#
# 綠界回的是一句話，沒有錯誤代碼可以對照，所以只能比對關鍵字。
# 每一條都寫出「為什麼」和「怎麼辦」——
# 只把原文貼給店家看，他還是不知道要去哪裡按什麼。
LOGISTICS_HINTS: list[tuple[tuple[str, ...], str, list[str]]] = [
    (
        ("可提領餘額", "餘額為負數", "不足支付物流運費"),
        "綠界帳戶餘額不足，付不出這筆運費",
        [
            "超商店到店的運費是**由你先付**的 —— 綠界會從你的帳戶餘額扣，"
            "不是等買家取貨才收。所以帳戶是 0 元就建不了單。",
            "解法：到綠界廠商後台 →「綠界帳戶管理 →**預付款項**」儲值。"
            "一筆超商運費約 70 元，先存個一兩千塊就夠跑一陣子。",
            "**順便檢查「自動提領設定」**。如果設了每日自動提領，"
            "錢一進來就被領走，餘額永遠是 0，建單會一直失敗。"
            "建議先關掉，等出貨穩定了再改成每週或每月。",
            "（提領手續費 15 元／次，每天領一次也不划算。）",
        ],
    ),
    (
        ("門市", "不存在", "已停止", "暫停營業"),
        "買家選的門市目前無法收件",
        [
            "可能是門市整修、停業，或綠界的門市資料還沒更新。",
            "請聯絡買家改選其他門市，或改用宅配。",
        ],
    ),
    (
        ("金額", "上限", "超過"),
        "訂單金額超過這個配送方式的上限",
        [
            "超商取貨與代收貨款的單筆上限是 20,000 元。",
            "請改用宅配，或請買家分兩筆下單。",
        ],
    ),
    (
        ("MerchantID", "廠商編號", "查無此廠商"),
        "綠界的廠商編號或金鑰不正確",
        [
            "檢查後端環境變數的 `ECPAY_C2C_MERCHANT_ID` / `HASH_KEY` / `HASH_IV`，"
            "是否與綠界後台「系統設定 → 系統介接設定」的**物流**那一列相同。",
            "另外確認 `ECPAY_LOGISTICS_ENV` 有沒有設對 —— "
            "正式金鑰配測試環境（或反過來）都會被退回。",
        ],
    ),
    (
        ("CheckMacValue",),
        "檢查碼驗證失敗",
        [
            "通常是 HashKey 或 HashIV 貼錯（少一個字、多一個空格）。",
            "綠界的金鑰有容易看錯的字元：數字 0 與大寫 O、數字 1 與大寫 I 和小寫 l。"
            "建議直接從後台複製貼上，不要用打的。",
        ],
    ),
    (
        ("尚未申請", "未開通", "未啟用"),
        "這個物流服務還沒開通",
        [
            "到綠界後台「驗證/服務申請」確認物流已開通，"
            "並在「物流管理 → 修改物流型態」把要用的超商與宅配都勾起來。",
        ],
    ),
]


def explain_logistics_error(raw: str) -> tuple[str, list[str]]:
    """把綠界的錯誤訊息翻成標題與處理步驟。認不出來就回原文。"""
    text = raw or ""
    for keywords, title, steps in LOGISTICS_HINTS:
        if sum(1 for k in keywords if k in text) >= min(2, len(keywords)):
            return title, steps
    return "綠界建立物流單失敗", [
        f"綠界回報：{text[:200]}",
        "如果看不懂這句話，把它整段貼給我，我幫你看是什麼問題。",
    ]


def _build_create_params(db: Session, order: Order) -> tuple[str, dict, str, str]:
    """組出建立物流訂單所需的參數。回傳 (物流類型, 參數, HashKey, HashIV)。"""
    mapping = SHIPPING_MAP.get(order.shipping_method.value)
    if not mapping:
        raise HTTPException(status_code=400, detail="訂單的送貨方式無效")
    logistics_type, sub_type, label, _ = mapping

    merchant_id, hash_key, hash_iv = settings.logistics_credentials(logistics_type)
    cfg = get_shipping_settings(db)
    base = settings.BACKEND_BASE_URL.rstrip("/")

    # 先檢查寄件人資料，避免送出去才被綠界用英文欄位名退回
    _check_sender(cfg, logistics_type, sub_type)

    sender_name = sanitize_name(cfg.get("sender_name") or "蜂蜜工坊", fallback="賣家")
    goods_name = sanitize_goods_name(
        "、".join(i.product_name for i in order.items) or "蜂蜜商品"
    )
    receiver_cell = sanitize_cellphone(order.receiver_phone)
    if not receiver_cell:
        raise HTTPException(
            status_code=400,
            detail=f"訂單 {order.order_no} 的收件人電話不是有效手機號碼（需 09 開頭 10 碼），無法建立物流單",
        )

    # 代收貨款金額必須等於商品金額
    is_collection = order.payment_method == PaymentMethod.cod
    goods_amount = int(round(float(order.total_amount)))

    params: dict[str, object] = {
        "MerchantID": merchant_id,
        "MerchantTradeNo": order.order_no[:20],
        "MerchantTradeDate": order.created_at.strftime("%Y/%m/%d %H:%M:%S"),
        "LogisticsType": logistics_type,
        "LogisticsSubType": sub_type,
        "GoodsAmount": goods_amount,
        "GoodsName": goods_name,
        "SenderName": sender_name,
        "SenderPhone": sanitize_phone(cfg.get("sender_phone") or ""),
        "SenderCellPhone": sanitize_cellphone(cfg.get("sender_cellphone") or ""),
        "ReceiverName": sanitize_name(order.receiver_name),
        "ReceiverPhone": sanitize_phone(order.receiver_phone),
        "ReceiverCellPhone": receiver_cell,
        "ReceiverEmail": "",
        "TradeDesc": "",
        "ServerReplyURL": f"{base}/api/logistics/callback",
        "IsCollection": "Y" if is_collection else "N",
        "Remark": (order.note or "")[:200],
        "PlatformID": "",
    }

    if logistics_type == "CVS":
        if not order.cvs_store_id:
            raise HTTPException(status_code=400, detail="這筆訂單沒有取貨門市資料")
        params["ReceiverStoreID"] = order.cvs_store_id
        if is_collection:
            params["CollectionAmount"] = goods_amount
    else:
        if not order.receiver_address:
            raise HTTPException(status_code=400, detail="這筆訂單沒有收件地址")
        params["SenderZipCode"] = cfg.get("sender_zipcode") or ""
        params["SenderAddress"] = cfg.get("sender_address") or ""
        params["ReceiverZipCode"] = order.receiver_zipcode or ""
        params["ReceiverAddress"] = order.receiver_address
        if sub_type == "TCAT":
            params["Temperature"] = order.temperature or Temperature.normal.value
            params["Distance"] = order.distance or "00"
            params["Specification"] = order.specification or "0001"
            params["ScheduledPickupTime"] = "4"      # 目前綠界固定帶 4（不限時）
            params["ScheduledDeliveryTime"] = "4"
        else:
            # 中華郵政：只支援常溫，且重量必填
            params["Temperature"] = Temperature.normal.value
            params["GoodsWeight"] = "1"

    return logistics_type, params, hash_key, hash_iv


@router.post("/orders/{order_id}/create", dependencies=[Depends(require_staff)])
def create_logistics_order(order_id: int, db: Session = Depends(get_db)):
    """工作人員在後台按下「建立物流單」時呼叫。

    成功後會拿到寄件代碼（超商）或託運單號（宅配）。
    """
    order = (
        db.query(Order).options(joinedload(Order.items)).filter(Order.id == order_id).first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")
    if order.allpay_logistics_id:
        raise HTTPException(status_code=400, detail="這筆訂單已經建立過物流單了")

    logistics_type, params, hash_key, hash_iv = _build_create_params(db, order)
    signed = with_check_mac_value(params, hash_key, hash_iv, algorithm="md5")

    url = f"{settings.ecpay_logistics_host}/Express/Create"
    try:
        resp = httpx.post(url, data=signed, timeout=30.0,
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
        resp.raise_for_status()
        body = resp.text
    except httpx.HTTPError as exc:
        _log(db, "logistics_create", order.order_no, False, f"連線失敗：{exc}", signed)
        db.commit()
        raise HTTPException(status_code=502, detail=f"無法連線到綠界物流：{exc}") from exc

    ok, data, err = parse_backend_response(body)
    _log(db, "logistics_create", order.order_no, ok, err or data.get("RtnMsg", ""),
         {"request": signed, "response": body})

    if not ok:
        title, steps = explain_logistics_error(err)
        order.logistics_status = LogisticsStatus.failed
        order.logistics_message = f"{title}｜綠界原文：{err}"[:300]
        db.commit()
        # detail 用結構化的內容，前端才能把「怎麼辦」排版成清單，
        # 而不是把一整段文字塞在紅色橫條裡
        raise HTTPException(
            status_code=400,
            detail={"title": title, "steps": steps, "raw": err[:300]},
        )

    order.allpay_logistics_id = data.get("AllPayLogisticsID") or None
    order.cvs_payment_no = data.get("CVSPaymentNo") or None
    order.cvs_validation_no = data.get("CVSValidationNo") or None
    order.booking_note = data.get("BookingNote") or None
    order.logistics_status = STATUS_MAP.get(data.get("RtnCode", ""), LogisticsStatus.created)
    order.logistics_message = (data.get("RtnMsg") or "")[:300]
    order.logistics_updated_at = datetime.now()
    if order.status == OrderStatus.pending:
        order.status = OrderStatus.paid if order.payment_status.value == "paid" else order.status
    db.commit()
    db.refresh(order)

    return {
        "ok": True,
        "logistics_type": logistics_type,
        "allpay_logistics_id": order.allpay_logistics_id,
        "cvs_payment_no": order.cvs_payment_no,
        "cvs_validation_no": order.cvs_validation_no,
        "booking_note": order.booking_note,
        "message": order.logistics_message,
    }


# ------------------------------------------------------------------ 列印託運單

PRINT_PATHS = {
    "UNIMARTC2C": "/Express/PrintUniMartC2COrderInfo",
    "FAMIC2C": "/Express/PrintFAMIC2COrderInfo",
    "HILIFEC2C": "/Express/PrintHILIFEC2COrderInfo",
}


@router.get("/orders/{order_id}/print", response_class=HTMLResponse,
            dependencies=[Depends(require_staff)])
def print_shipping_label(order_id: int, db: Session = Depends(get_db)):
    """導轉到綠界的託運單列印頁（會開新視窗，不可用 iframe）。"""
    order = db.get(Order, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="找不到訂單")
    if not order.allpay_logistics_id:
        raise HTTPException(status_code=400, detail="請先建立物流單")

    logistics_type, sub_type, _, _ = SHIPPING_MAP[order.shipping_method.value]
    merchant_id, hash_key, hash_iv = settings.logistics_credentials(logistics_type)

    if logistics_type == "HOME":
        path = "/helper/printTradeDocument"
        params: dict[str, object] = {
            "MerchantID": merchant_id,
            "AllPayLogisticsID": order.allpay_logistics_id,
        }
    else:
        path = PRINT_PATHS.get(sub_type)
        if not path:
            raise HTTPException(status_code=400, detail="這個超商不支援線上列印，請至門市機台操作")
        params = {
            "MerchantID": merchant_id,
            "AllPayLogisticsID": order.allpay_logistics_id,
            "CVSPaymentNo": order.cvs_payment_no or "",
        }
        if sub_type == "UNIMARTC2C":
            params["CVSValidationNo"] = order.cvs_validation_no or ""

    signed = with_check_mac_value(params, hash_key, hash_iv, algorithm="md5")
    return HTMLResponse(auto_submit_form(
        f"{settings.ecpay_logistics_host}{path}", signed,
        title="列印託運單", note="正在開啟綠界託運單列印頁…",
    ))


# ------------------------------------------------------------------ 物流狀態通知

@router.post("/callback", response_class=PlainTextResponse)
async def logistics_callback(request: Request, db: Session = Depends(get_db)):
    """綠界的物流狀態通知（ServerReplyURL）。必須回覆 1|OK。"""
    form = {k: str(v) for k, v in (await request.form()).items()}
    order_no = form.get("MerchantTradeNo", "")

    logistics_type = "HOME" if form.get("LogisticsType") == "HOME" else "CVS"
    _, hash_key, hash_iv = settings.logistics_credentials(logistics_type)

    if not verify_check_mac_value(form, hash_key, hash_iv, algorithm="md5"):
        _log(db, "logistics_callback", order_no, False, "檢查碼驗證失敗", form)
        db.commit()
        return PlainTextResponse("0|CheckMacValue Error")

    order = db.query(Order).filter(Order.order_no == order_no).first()
    if order:
        code = form.get("RtnCode", "")
        order.logistics_status = STATUS_MAP.get(code, order.logistics_status)
        order.logistics_message = (form.get("RtnMsg") or "")[:300]
        order.logistics_updated_at = datetime.now()
        if not order.allpay_logistics_id:
            order.allpay_logistics_id = form.get("AllPayLogisticsID") or None
        if not order.cvs_payment_no:
            order.cvs_payment_no = form.get("CVSPaymentNo") or None
        if not order.cvs_validation_no:
            order.cvs_validation_no = form.get("CVSValidationNo") or None
        if not order.booking_note:
            order.booking_note = form.get("BookingNote") or None

        if order.logistics_status in (LogisticsStatus.shipped, LogisticsStatus.arrived):
            if order.status in (OrderStatus.pending, OrderStatus.paid):
                order.status = OrderStatus.shipped
        elif order.logistics_status == LogisticsStatus.picked:
            order.status = OrderStatus.completed

    _log(db, "logistics_callback", order_no, True, form.get("RtnMsg", ""), form)
    db.commit()
    return PlainTextResponse("1|OK")
