"""綠界科技 ECPay 串接共用工具。

涵蓋：
  - CheckMacValue 檢查碼（物流用 MD5、金流用 SHA256）
  - .NET 風格的 URL encode（綠界的檢查碼規則要求）
  - 自動送出表單（綠界多數 API 是「瀏覽器 POST 導轉」而非 JSON）
  - 幕後 API 呼叫與回應解析
  - 欄位清洗（姓名、電話等，綠界對格式檢核很嚴）

官方文件：
  物流 https://developers.ecpay.com.tw/?p=7380
  金流 https://developers.ecpay.com.tw/?p=2509
"""
from __future__ import annotations

import hashlib
import re
from html import escape
from urllib.parse import quote_plus

# ---------------------------------------------------------------- 檢查碼


def dotnet_url_encode(value: str) -> str:
    """模擬 .NET 的 HttpUtility.UrlEncode，這是綠界檢查碼要求的編碼方式。

    與 Python 的 quote_plus 有三處差異：
      - .NET 不編碼 ! * ( ) ，Python 會編成 %21 %2a %28 %29
      - .NET 會把 ~ 編成 %7e，Python 不編
      - 十六進位用小寫（這步由後續統一轉小寫處理）
    """
    encoded = quote_plus(value, safe="")
    encoded = encoded.replace("%21", "!").replace("%2A", "*").replace("%2a", "*")
    encoded = encoded.replace("%28", "(").replace("%29", ")")
    encoded = encoded.replace("~", "%7e")
    return encoded


def make_check_mac_value(
    params: dict[str, object],
    hash_key: str,
    hash_iv: str,
    algorithm: str = "sha256",
) -> str:
    """依綠界規則計算 CheckMacValue。

    步驟：參數按 A-Z 排序 → 前後加 HashKey/HashIV → URL encode → 轉小寫
         → MD5 或 SHA256 → 轉大寫

    algorithm: 物流 API 用 "md5"，金流 API 用 "sha256"
    """
    items = {k: v for k, v in params.items() if k != "CheckMacValue"}
    ordered = sorted(items.items(), key=lambda kv: kv[0].lower())
    raw = "&".join(f"{k}={'' if v is None else v}" for k, v in ordered)
    raw = f"HashKey={hash_key}&{raw}&HashIV={hash_iv}"

    encoded = dotnet_url_encode(raw).lower()

    if algorithm.lower() == "md5":
        digest = hashlib.md5(encoded.encode("utf-8")).hexdigest()
    else:
        digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return digest.upper()


def verify_check_mac_value(
    params: dict[str, object],
    hash_key: str,
    hash_iv: str,
    algorithm: str = "sha256",
) -> bool:
    """驗證綠界回傳資料的檢查碼，避免偽造的付款/物流通知。"""
    received = str(params.get("CheckMacValue") or "").upper()
    if not received:
        return False
    expected = make_check_mac_value(params, hash_key, hash_iv, algorithm)
    # 用固定時間比較，避免時序攻擊
    return hashlib.sha256(received.encode()).digest() == hashlib.sha256(expected.encode()).digest()


def with_check_mac_value(
    params: dict[str, object],
    hash_key: str,
    hash_iv: str,
    algorithm: str = "sha256",
) -> dict[str, str]:
    """回傳補上 CheckMacValue 的參數字典（值都轉為字串）。"""
    clean = {k: ("" if v is None else str(v)) for k, v in params.items() if k != "CheckMacValue"}
    clean["CheckMacValue"] = make_check_mac_value(clean, hash_key, hash_iv, algorithm)
    return clean


# ---------------------------------------------------------------- 自動送出表單


def auto_submit_form(
    action: str,
    params: dict[str, str],
    title: str = "處理中，請稍候…",
    note: str = "正在將您導向綠界，請勿關閉此視窗。",
) -> str:
    """產生一頁會自動 POST 到綠界的 HTML。

    綠界的電子地圖、付款頁、列印託運單都要求用瀏覽器 POST 導轉，
    且明確規定不可放在 iframe 內（會被擋）。
    """
    fields = "\n".join(
        f'    <input type="hidden" name="{escape(str(k))}" value="{escape(str(v))}" />'
        for k, v in params.items()
    )
    return f"""<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{escape(title)}</title>
<style>
  body {{ font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif;
         background: #fdfaf3; color: #33291d; display: flex; align-items: center;
         justify-content: center; height: 100vh; margin: 0; }}
  .box {{ text-align: center; }}
  .spinner {{ width: 34px; height: 34px; margin: 0 auto 18px; border: 3px solid #f0e4c8;
              border-top-color: #c8952b; border-radius: 50%; animation: spin .8s linear infinite; }}
  @keyframes spin {{ to {{ transform: rotate(360deg); }} }}
  p {{ font-size: 14px; color: #6d6053; }}
  noscript button {{ padding: 10px 24px; background: #c8952b; color: #fff;
                     border: none; border-radius: 4px; font-size: 15px; }}
</style>
</head>
<body>
  <div class="box">
    <div class="spinner"></div>
    <p>{escape(note)}</p>
  </div>
  <form id="ecpay-form" method="post" action="{escape(action)}" accept-charset="utf-8">
{fields}
    <noscript><button type="submit">請點此繼續</button></noscript>
  </form>
  <script>document.getElementById('ecpay-form').submit();</script>
</body>
</html>"""


# ---------------------------------------------------------------- 回應解析


def parse_backend_response(text: str) -> tuple[bool, dict[str, str], str]:
    """解析綠界「幕後」API 的回應。

    成功：1|MerchantID=XXX&MerchantTradeNo=XXX&...
    失敗：0|錯誤訊息

    回傳 (是否成功, 參數字典, 錯誤訊息)
    """
    text = (text or "").strip()
    if not text:
        return False, {}, "綠界沒有回應內容"

    flag, _, payload = text.partition("|")
    flag = flag.strip()
    payload = payload.strip()

    if flag != "1":
        return False, {}, payload or text

    data: dict[str, str] = {}
    for pair in payload.split("&"):
        if "=" in pair:
            k, _, v = pair.partition("=")
            data[k.strip()] = v.strip()
    return True, data, ""


# ---------------------------------------------------------------- 欄位清洗

# 綠界姓名欄位禁止數字與特殊符號，且限 4~10 字元（中文 2~5 字）
_NAME_DISALLOWED = re.compile(r"[0-9\s~!@#$%^&*()_+\-=\[\]{}|\\:;\"'<>,.?/`。，、；：「」『』（）！？]")


def sanitize_name(name: str, fallback: str = "買家") -> str:
    """清成綠界能接受的姓名。

    規則：不可有數字或特殊符號；長度 4~10 字元（中文算 2 字元，即 2~5 個中文字）。
    """
    cleaned = _NAME_DISALLOWED.sub("", name or "").strip()
    if not cleaned:
        cleaned = fallback

    # 依綠界算法計算長度：中文/全形算 2，其餘算 1
    def width(s: str) -> int:
        return sum(2 if ord(ch) > 0x7F else 1 for ch in s)

    # 太長就截斷
    while width(cleaned) > 10 and len(cleaned) > 1:
        cleaned = cleaned[:-1]

    # 太短就補字（半形至少要 4 字元）
    if width(cleaned) < 4:
        cleaned = (cleaned + fallback)[:5]
        while width(cleaned) > 10 and len(cleaned) > 1:
            cleaned = cleaned[:-1]
    return cleaned


def sanitize_cellphone(phone: str) -> str:
    """手機號碼：只留數字，必須 09 開頭共 10 碼。不合規則回傳空字串。"""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("886"):
        digits = "0" + digits[3:]
    if len(digits) == 10 and digits.startswith("09"):
        return digits
    return ""


def sanitize_phone(phone: str) -> str:
    """市話：允許數字與 ( ) - # 這幾個符號。"""
    return re.sub(r"[^0-9()\-#]", "", phone or "")[:20]


# 綠界商品名稱禁止的特殊符號
_GOODS_DISALLOWED = re.compile(r"[\^'`!@#%&*+\\\"<>|_\[\]]")


def sanitize_goods_name(name: str, fallback: str = "商品一批") -> str:
    """商品名稱：移除綠界禁用符號，並限制在 50 字元內。"""
    cleaned = _GOODS_DISALLOWED.sub(" ", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return (cleaned or fallback)[:50]


def extract_zipcode(address: str) -> str:
    """從地址開頭抓出 3~6 碼郵遞區號，抓不到回傳空字串。"""
    m = re.match(r"^\s*(\d{3,6})", address or "")
    return m.group(1) if m else ""
