"""工作人員上傳商品／新聞照片。

安全性重點：**不要只相信副檔名。** 副檔名是使用者自己取的，
把一個 HTML 或 SVG 檔改名成 .jpg 一樣傳得上來。
所以這裡連檔案開頭的「魔術位元組」一起驗，確認它真的是那種圖片格式。
"""
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..deps import require_staff
from ..schemas import UploadOut

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

UPLOAD_DIR = Path(__file__).resolve().parent.parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_SIZE = 8 * 1024 * 1024  # 8MB

# 每種格式檔案開頭長什麼樣。
# 刻意不收 SVG —— SVG 是 XML，裡面可以放 <script>，
# 被瀏覽器當成圖片開啟時會執行，是很典型的儲存型 XSS 管道。
SIGNATURES: dict[str, tuple[str, ...]] = {
    ".jpg": ("ffd8ff",),
    ".jpeg": ("ffd8ff",),
    ".png": ("89504e470d0a1a0a",),
    ".gif": ("474946383761", "474946383961"),          # GIF87a / GIF89a
    ".webp": ("52494646",),                             # RIFF....WEBP
    ".avif": ("",),                                     # 另外用 ftyp 判斷
}
ALLOWED_EXT = set(SIGNATURES)

# 副檔名統一，避免同一種格式出現兩種寫法
CANONICAL = {".jpeg": ".jpg"}


def looks_like_image(ext: str, head: bytes) -> bool:
    """檢查檔案開頭是不是真的長得像那種圖片。"""
    hexed = head[:16].hex()

    if ext == ".webp":
        # RIFF????WEBP：第 0~3 是 RIFF，第 8~11 是 WEBP
        return hexed.startswith("52494646") and head[8:12] == b"WEBP"
    if ext == ".avif":
        # ISO BMFF：第 4~7 是 ftyp，接著是 avif / avis
        return head[4:8] == b"ftyp" and head[8:12] in (b"avif", b"avis", b"mif1")

    return any(sig and hexed.startswith(sig) for sig in SIGNATURES.get(ext, ()))


@router.post("", response_model=UploadOut, dependencies=[Depends(require_staff)])
async def upload_image(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"只接受這些圖片格式：{', '.join(sorted(ALLOWED_EXT))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="檔案是空的")
    if len(content) > MAX_SIZE:
        mb = len(content) / 1024 / 1024
        raise HTTPException(
            status_code=400,
            detail=f"圖片有 {mb:.1f}MB，超過 8MB 上限。請先壓縮，"
                   "或用手機內建的「郵件尺寸」匯出。",
        )

    if not looks_like_image(ext, content):
        raise HTTPException(
            status_code=400,
            detail=f"這個檔案的內容看起來不是 {ext} 圖片。"
                   "如果是改過副檔名的檔案，請用小畫家或看圖軟體另存成真正的 JPG／PNG。",
        )

    # 檔名一律重新產生。用原始檔名的話，別人可以用 ../../ 這種路徑跳出上傳資料夾，
    # 或是用同名檔案覆蓋掉別人的圖。
    filename = f"{uuid.uuid4().hex}{CANONICAL.get(ext, ext)}"
    (UPLOAD_DIR / filename).write_bytes(content)
    return UploadOut(url=f"/uploads/{filename}", filename=filename)
