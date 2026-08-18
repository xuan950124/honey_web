"""登入嘗試次數限制。

密碼是用 bcrypt 存的，就算資料庫外洩也很難反推 —— 但那擋不住「線上猜密碼」：
拿一份常見密碼清單，對著登入 API 一直試。沒有次數限制的話，
弱密碼的帳號被猜中只是時間問題。

做法刻意做得很簡單：記在記憶體裡的計數器。
**限制是重啟後歸零、多個容器各算各的。** 對一個蜂蜜小舖來說這樣夠了 ——
真正要擋的是自動化腳本，而腳本不會因為我們重啟就停下來重來。
之後如果要更嚴謹（多台機器共用計數），再換成 Redis。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field

# 允許連續失敗幾次
MAX_FAILURES = 5
# 超過就鎖多久（秒）
LOCKOUT_SECONDS = 15 * 60
# 多久沒有新的失敗就把紀錄清掉（秒）
WINDOW_SECONDS = 15 * 60


@dataclass
class _Record:
    failures: int = 0
    first_at: float = field(default_factory=time.monotonic)
    locked_until: float = 0.0


_records: dict[str, _Record] = {}


def _now() -> float:
    # 用 monotonic 而不是 time.time()：系統時間被調整時不會讓鎖定提早解除
    return time.monotonic()


def _prune() -> None:
    """清掉過期的紀錄，避免這個 dict 無限長大。"""
    now = _now()
    stale = [
        key for key, rec in _records.items()
        if rec.locked_until < now and now - rec.first_at > WINDOW_SECONDS
    ]
    for key in stale:
        _records.pop(key, None)


def seconds_remaining(key: str) -> int:
    """這個對象還要被鎖多久。0 代表現在可以嘗試。"""
    rec = _records.get(key)
    if not rec:
        return 0
    left = rec.locked_until - _now()
    return int(left) + 1 if left > 0 else 0


def record_failure(key: str) -> int:
    """記一次失敗，回傳「還剩幾次機會」。回 0 代表已經被鎖住。"""
    _prune()
    now = _now()
    rec = _records.get(key)

    # 距離第一次失敗太久了就重新起算，不要把三天前的一次失敗算進來
    if rec and now - rec.first_at > WINDOW_SECONDS and rec.locked_until < now:
        rec = None

    if rec is None:
        rec = _Record()
        _records[key] = rec

    rec.failures += 1
    if rec.failures >= MAX_FAILURES:
        rec.locked_until = now + LOCKOUT_SECONDS
        return 0
    return MAX_FAILURES - rec.failures


def record_success(key: str) -> None:
    """登入成功就把計數清掉。"""
    _records.pop(key, None)


def reset() -> None:
    """測試用。"""
    _records.clear()
