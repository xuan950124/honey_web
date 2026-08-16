"""寄送 Email。

兩個設計重點：

1. **沒有設定 SMTP 也要能開發**
   未設定 SMTP_HOST 時，信件會存成 HTML 檔放到 backend/outbox/，
   可以直接用瀏覽器打開來看，等於一個本機的假信箱。

2. **盡量不要被當成垃圾郵件**
   - 補齊 Date、Message-ID 等標頭（缺這些會被當成程式亂發的信）
   - 標記為 Auto-Submitted，讓收件方知道這是交易通知而非行銷信
   - 同時提供結構良好的純文字版本（只有 HTML 沒有純文字是明顯的垃圾信特徵）
"""
from __future__ import annotations

import re
import smtplib
import ssl
from dataclasses import dataclass
from datetime import datetime
from email.header import Header
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from html import escape
from pathlib import Path

from .config import settings

OUTBOX_DIR = Path(__file__).resolve().parent.parent / "outbox"


@dataclass
class EmailContent:
    """一封信的兩種版本。多數郵件軟體看 HTML，純文字則是給文字型軟體與過濾器看的。"""
    html: str
    text: str


# ---------------------------------------------------------------- 版型

def render_email(title: str, greeting: str, body_lines: list[str],
                 button_text: str | None = None, button_url: str | None = None,
                 footer_note: str | None = None) -> EmailContent:
    """統一的信件版型（暖琥珀色系，與網站一致），同時產生 HTML 與純文字版本。"""
    shop = settings.SMTP_FROM_NAME or "蜂蜜工坊"
    footer = footer_note or "這是系統自動發送的信件，請勿直接回覆。"

    paragraphs = "".join(
        f'<p style="margin:0 0 14px;font-size:15px;line-height:1.85;color:#5a4a36;">{escape(line)}</p>'
        for line in body_lines
    )

    button = ""
    if button_text and button_url:
        button = f"""
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:26px 0;">
        <tr><td style="background:#c8952b;border-radius:4px;">
          <a href="{escape(button_url)}"
             style="display:inline-block;padding:13px 34px;color:#ffffff;font-size:15px;
                    text-decoration:none;font-weight:500;letter-spacing:0.05em;">
            {escape(button_text)}
          </a>
        </td></tr>
      </table>
      <p style="margin:0 0 8px;font-size:12.5px;color:#9c8a6e;">
        按鈕沒反應的話，請複製下面這串網址貼到瀏覽器：
      </p>
      <p style="margin:0 0 20px;font-size:12.5px;color:#a5762c;word-break:break-all;">
        {escape(button_url)}
      </p>"""

    html = f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#fdfaf3;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdfaf3;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
             style="max-width:560px;background:#ffffff;border:1px solid #e7ddc9;border-radius:8px;">
        <tr><td style="padding:28px 34px;border-bottom:1px solid #f0e8d8;">
          <div style="font-size:21px;color:#7a5424;letter-spacing:0.08em;font-weight:600;">{escape(shop)}</div>
        </td></tr>
        <tr><td style="padding:32px 34px;">
          <h1 style="margin:0 0 18px;font-size:20px;color:#3b2712;font-weight:600;">{escape(title)}</h1>
          <p style="margin:0 0 16px;font-size:15px;color:#5a4a36;">{escape(greeting)}</p>
          {paragraphs}
          {button}
        </td></tr>
        <tr><td style="padding:18px 34px;background:#fdf7e8;border-top:1px solid #f0e8d8;border-radius:0 0 8px 8px;">
          <p style="margin:0;font-size:12.5px;color:#9c8a6e;line-height:1.7;">{escape(footer)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>"""

    # 純文字版本直接用同一份資料組出來，而不是從 HTML 硬剝標籤，品質才會好
    lines = [shop, "=" * 30, "", title, "", greeting, ""]
    lines += body_lines
    if button_text and button_url:
        lines += ["", f"{button_text}：", button_url]
    lines += ["", "-" * 30, footer]
    text = "\n".join(lines)

    return EmailContent(html=html, text=text)


# ---------------------------------------------------------------- 寄送

def send_email(to: str, subject: str, content: EmailContent | str) -> tuple[bool, str]:
    """寄出一封信。回傳 (是否真的寄出, 說明)。

    沒設定 SMTP 時不算失敗，而是存到 outbox 供開發檢視。
    """
    if isinstance(content, str):   # 向下相容：只給 HTML 也能用
        content = EmailContent(html=content, text=_html_to_text(content))

    if not settings.smtp_configured:
        return _save_to_outbox(to, subject, content.html)

    message = _build_message(to, subject, content)

    try:
        if settings.SMTP_SSL:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT,
                                  context=context, timeout=20) as server:
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=20) as server:
                server.ehlo()
                if settings.SMTP_TLS:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if settings.SMTP_USER:
                    server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                server.send_message(message)
        return True, "已寄出"
    except Exception as exc:  # noqa: BLE001 - 寄信失敗不該讓 API 整個掛掉
        _save_to_outbox(to, subject, content.html, note=f"SMTP 失敗：{exc}")
        return False, f"寄信失敗：{exc}"


def _build_message(to: str, subject: str, content: EmailContent) -> MIMEMultipart:
    """組出標頭完整的郵件。

    缺少 Date / Message-ID 是很明顯的「機器亂發」特徵，
    多數垃圾郵件過濾器會因此扣分，所以這裡一律補齊。
    """
    message = MIMEMultipart("alternative")
    message["Subject"] = Header(subject, "utf-8")
    message["From"] = formataddr((str(Header(settings.SMTP_FROM_NAME, "utf-8")), settings.mail_from))
    message["To"] = to
    message["Date"] = formatdate(localtime=True)

    # Message-ID 的網域用寄件信箱的網域，與 From 一致才不會被視為偽造
    domain = (parseaddr(settings.mail_from)[1].split("@") + ["localhost"])[1]
    message["Message-ID"] = make_msgid(domain=domain)

    message["Reply-To"] = settings.mail_from
    # 標記為系統自動發出的交易信，避免收件方的自動回覆造成迴圈
    message["Auto-Submitted"] = "auto-generated"

    # 純文字要放在前面，HTML 放後面——郵件軟體會挑最後一個看得懂的版本顯示
    message.attach(MIMEText(content.text, "plain", "utf-8"))
    message.attach(MIMEText(content.html, "html", "utf-8"))
    return message


def _html_to_text(html: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", html)
    text = re.sub(r"</p>|</h1>|</td>|</tr>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _save_to_outbox(to: str, subject: str, html: str, note: str = "") -> tuple[bool, str]:
    OUTBOX_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_to = re.sub(r"[^\w.@-]", "_", to)
    path = OUTBOX_DIR / f"{stamp}_{safe_to}.html"

    banner = f"""<div style="background:#fdf0eb;border:1px solid #f0c6b6;padding:14px 18px;
      font-family:sans-serif;font-size:13px;color:#b3401f;">
      <strong>這是開發用的本機信件</strong>（尚未設定 SMTP，所以沒有真的寄出）<br />
      收件者：{escape(to)}　主旨：{escape(subject)}
      {f"<br />{escape(note)}" if note else ""}
    </div>"""
    path.write_text(banner + html, encoding="utf-8")
    return False, f"未設定 SMTP，信件已存到 backend/outbox/{path.name}"
