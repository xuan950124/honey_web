"""寄信設定檢測工具。

用法（在 backend 資料夾下）：
    python -m app.test_mail 你的信箱@gmail.com

會檢查設定、實際寄一封測試信，並針對常見錯誤給出具體的修正建議。
"""
import sys
import smtplib

from .config import settings
from .mailer import render_email, send_email


def _mask(value: str) -> str:
    if not value:
        return "（未設定）"
    if len(value) <= 4:
        return "*" * len(value)
    return value[:2] + "*" * (len(value) - 4) + value[-2:]


def diagnose(exc: Exception) -> list[str]:
    """把 SMTP 的錯誤翻譯成看得懂的修正建議。"""
    text = str(exc)
    tips: list[str] = []

    if isinstance(exc, smtplib.SMTPAuthenticationError) or "535" in text or "Username and Password not accepted" in text:
        tips += [
            "帳號或密碼被拒絕。用 Gmail 的話請確認：",
            "  1. 已在 Google 帳號開啟「兩步驟驗證」",
            "  2. SMTP_PASSWORD 填的是 16 碼的「應用程式密碼」，不是 Gmail 登入密碼",
            "  3. 應用程式密碼中間的空格要刪掉（例如 abcd efgh ijkl mnop -> abcdefghijklmnop）",
            "  4. SMTP_USER 和 SMTP_FROM 要是同一個 Gmail 地址",
        ]
    elif isinstance(exc, smtplib.SMTPConnectError) or "getaddrinfo" in text or "11001" in text or "11003" in text:
        tips += [
            "連不到 SMTP 主機。請確認：",
            "  1. SMTP_HOST 有沒有拼錯（Gmail 是 smtp.gmail.com）",
            "  2. 網路是否正常，或防火牆／防毒軟體是否擋住 587 埠",
        ]
    elif "timed out" in text.lower():
        tips += [
            "連線逾時。可能是防火牆擋住了，或該用不同的埠：",
            "  587 埠請設 SMTP_TLS=true、SMTP_SSL=false",
            "  465 埠請設 SMTP_SSL=true、SMTP_TLS=false",
        ]
    elif "STARTTLS" in text:
        tips += [
            "TLS 設定不符。587 埠請用 SMTP_TLS=true、SMTP_SSL=false；",
            "465 埠請用 SMTP_SSL=true、SMTP_TLS=false。",
        ]
    else:
        tips.append("請把上面的錯誤訊息貼出來以便進一步排查。")
    return tips


def main() -> int:
    to = sys.argv[1] if len(sys.argv) > 1 else settings.SMTP_USER
    if not to:
        print("請指定收件信箱，例如：python -m app.test_mail 你的信箱@gmail.com")
        return 1

    print("=" * 60)
    print("目前的寄信設定")
    print("=" * 60)
    print(f"  SMTP_HOST     : {settings.SMTP_HOST or '（未設定）'}")
    print(f"  SMTP_PORT     : {settings.SMTP_PORT}")
    print(f"  SMTP_USER     : {settings.SMTP_USER or '（未設定）'}")
    print(f"  SMTP_PASSWORD : {_mask(settings.SMTP_PASSWORD)}")
    print(f"  SMTP_FROM     : {settings.mail_from}")
    print(f"  SMTP_TLS/SSL  : TLS={settings.SMTP_TLS}  SSL={settings.SMTP_SSL}")
    print(f"  APP_ENV       : {settings.APP_ENV}")
    print()

    if not settings.smtp_configured:
        print("SMTP_HOST 是空的，目前不會真的寄信。")
        print("信件會存成 HTML 放在 backend/outbox/，用瀏覽器打開就能看。")
        print("要真的寄信請到 backend\\.env 填入 SMTP 設定後再執行一次。")
        return 1

    # 常見設定錯誤的提前提醒
    warnings = []
    if settings.SMTP_HOST == "smtp.gmail.com":
        pw = settings.SMTP_PASSWORD
        if " " in pw:
            warnings.append("SMTP_PASSWORD 裡有空格，Gmail 的應用程式密碼要把空格刪掉")
        elif pw and len(pw) != 16:
            warnings.append(f"SMTP_PASSWORD 長度是 {len(pw)}，Gmail 的應用程式密碼應為 16 碼")
        if settings.SMTP_PORT == 587 and settings.SMTP_SSL:
            warnings.append("587 埠應該用 SMTP_TLS=true、SMTP_SSL=false")
        if settings.SMTP_FROM and settings.SMTP_FROM != settings.SMTP_USER:
            warnings.append("Gmail 通常要求 SMTP_FROM 與 SMTP_USER 相同")
    if warnings:
        print("設定看起來有問題：")
        for w in warnings:
            print(f"  - {w}")
        print()

    print("=" * 60)
    print(f"寄送測試信到 {to}")
    print("=" * 60)

    html = render_email(
        title="寄信設定測試成功",
        greeting="你好，",
        body_lines=[
            "如果你看到這封信，代表網站的寄信設定已經正常運作。",
            "之後的會員驗證信與重設密碼信都會用這個設定寄出。",
        ],
        button_text="前往網站",
        button_url=settings.FRONTEND_BASE_URL,
        footer_note="這是一封測試信，可以直接刪除。",
    )

    try:
        sent, message = send_email(to, "【測試】寄信設定確認", html)
    except Exception as exc:  # noqa: BLE001
        print(f"寄送時發生例外：{type(exc).__name__}: {exc}\n")
        for tip in diagnose(exc):
            print(tip)
        return 1

    if sent:
        print("成功！請到收件匣確認（沒看到的話檢查垃圾郵件匣）。")
        return 0

    print(f"沒有寄出：{message}\n")
    if "SMTP 失敗" in message:
        detail = message.split("SMTP 失敗：", 1)[-1]
        for tip in diagnose(Exception(detail)):
            print(tip)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
