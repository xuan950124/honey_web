"""郵遞區號：368 個鄉鎮市區都查得到，而且重名的不會抓錯。

## 為什麼這份測試值得寫

寄錯縣市的包裹不會有人回報。「台中市東區」被算成「台中中區」，
兩個都在台中，客人收不到就只是覺得這家店很爛，你永遠不知道錯在哪。

所以這裡逐筆掃過全部 368 個鄉鎮市區，每一個都要能查回自己的郵遞區號。

執行：
    cd backend
    python tests/test_zipcode.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import zipcode  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent

passed = 0
failures: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global passed
    if condition:
        passed += 1
        print(f"  ok   {name}")
    else:
        failures.append(f"{name}{f' — {detail}' if detail else ''}")
        print(f"  FAIL {name}{f' — {detail}' if detail else ''}")


def test_every_district_resolves():
    """全部 368 個鄉鎮市區，每一個都要查得回自己。"""
    print("\n[全表自檢]")
    total = sum(len(d) for d in zipcode.CITY_DISTRICTS.values())
    check("剛好 368 個鄉鎮市區", total == 368, str(total))
    check("22 個縣市", len(zipcode.CITY_DISTRICTS) == 22,
          str(len(zipcode.CITY_DISTRICTS)))

    bad = []
    for city, districts in zipcode.CITY_DISTRICTS.items():
        for district, code in districts.items():
            for address in (f"{city}{district}中正路1號",
                            f"{city}{district}",
                            city.replace("臺", "台") + district + "1號"):
                got = zipcode.lookup(address)
                if got != code:
                    bad.append(f"{address} → {got or '(空)'}，應該是 {code}")

    check("每一個區都查得回自己（含台／臺兩種寫法）", not bad,
          "；".join(bad[:5]) + (f" 等 {len(bad)} 筆" if len(bad) > 5 else ""))

    codes = {c for d in zipcode.CITY_DISTRICTS.values() for c in d.values()}
    check("郵遞區號都是 3 碼數字",
          all(re.fullmatch(r"\d{3}", c) for c in codes))


def test_duplicate_district_names():
    """區名重複的時候，一定要看縣市。

    這是整個功能最容易錯、而且錯了最難發現的地方。
    """
    print("\n[同名的區不能抓錯]")
    cases = [
        ("臺北市中正區重慶南路1號", "100"),
        ("基隆市中正區中正路1號", "202"),
        ("臺北市信義區市府路1號", "110"),
        ("基隆市信義區信二路1號", "201"),
        ("臺北市大安區羅斯福路四段1號", "106"),
        ("臺中市大安區中松路1號", "439"),
        ("臺北市中山區南京東路1號", "104"),
        ("基隆市中山區中山一路1號", "203"),
        # 「東區」有四個
        ("新竹市東區光復路二段101號", "300"),
        ("臺中市東區進化路1號", "401"),
        ("嘉義市東區中山路1號", "600"),
        ("臺南市東區大學路1號", "701"),
        # 「東勢」一個是區一個是鄉
        ("臺中市東勢區豐勢路1號", "423"),
        ("雲林縣東勢鄉新坊路1號", "635"),
    ]
    for address, want in cases:
        got = zipcode.lookup(address)
        check(f"{address[:12]} → {want}", got == want, f"查到 {got or '(空)'}")

    check("臺中市東區不會被『中區』搶走",
          zipcode.lookup("臺中市東區進化路1號") != "400",
          "去掉『區』只剩一個『中』，在『臺中市』裡就中了 —— "
          "完整名稱一定要先比完")


def test_real_and_messy_addresses():
    print("\n[實際會遇到的寫法]")
    cases = [
        ("基隆市七堵區華新一路103號", "206", "這次建單失敗的那筆"),
        ("206基隆市七堵區華新一路103號", "206", "客人自己填了郵遞區號"),
        ("20648基隆市七堵區華新一路103號", "206", "5 碼只取前 3 碼"),
        ("七堵區華新一路103號", "206", "沒寫縣市，但七堵全台唯一"),
        ("台北市信義區市府路45號", "110", "用『台』不用『臺』"),
        ("　基隆市 七堵區 華新一路103號　", "206", "有多餘空白"),
        ("基隆市七堵區華新一路１０３號", "206", "全形數字"),
        ("新北市新莊區中正路100號", "242", ""),
        ("桃園市中壢區中大路300號", "320", ""),
        ("屏東縣三地門鄉中正路1號", "901", "四個字的鄉名"),
        ("高雄市那瑪夏區1號", "849", ""),
        ("臺南市新市區華大一路1號", "744", "『新市區』不能被『市區』誤判"),
    ]
    for address, want, why in cases:
        got = zipcode.lookup(address)
        check(f"{address.strip()[:16]} → {want}{f'（{why}）' if why else ''}",
              got == want, f"查到 {got or '(空)'}")


def test_gives_up_rather_than_guessing():
    """查不出來就回空字串，不要猜。

    猜錯的成本比查不到高很多：查不到會跳出訊息請人補地址，
    猜錯是包裹直接寄到別的縣市。
    """
    print("\n[查不出來就承認]")
    for address in ("", "   ", "中正路1號", "我家", "台灣"):
        check(f"{address.strip() or '(空)'} → 空字串",
              zipcode.lookup(address) == "", zipcode.lookup(address))

    check("空地址講得出原因", "空" in zipcode.describe(""))
    check("缺縣市講得出原因", "縣市" in zipcode.describe("中正路1號"))
    check("缺區講得出原因", "鄉鎮市區" in zipcode.describe("基隆市中正路1號"))
    check("說明裡有舉例", "基隆市" in zipcode.describe("中正路1號"),
          "只說『請補完整』沒人知道要補什麼")


def test_outlying_islands():
    """離島綠界宅配不收，早點講比讓客人下單後被退好。"""
    print("\n[離島]")
    for address in ("澎湖縣馬公市1號", "金門縣金城鎮1號", "連江縣南竿鄉1號"):
        check(f"{address[:5]} 認得出是離島", zipcode.is_outlying(address) is True)
        check(f"{address[:5]} 還是查得到郵遞區號", zipcode.lookup(address) != "",
              "認得出是離島跟查不查得到是兩件事")
    for address in ("基隆市七堵區1號", "臺東縣蘭嶼鄉1號"):
        check(f"{address[:6]} 不是離島（綠界有收）",
              zipcode.is_outlying(address) is False)
    check("離島的說明講得出為什麼", "宅配" in zipcode.describe("澎湖縣馬公市1號"))


def test_frontend_table_matches_backend():
    """前後端兩份表不能不一樣。

    前端那份是為了「邊打邊帶出」，後端那份是建單時的最後防線。
    只改一邊的話，客人看到的郵遞區號會跟實際送出去的不同 ——
    這種不一致查起來會很痛苦。
    """
    print("\n[前後端資料一致]")
    js = (ROOT / "frontend/src/lib/zipcode.js").read_text("utf-8")

    front: dict[str, dict[str, str]] = {}
    city = None
    for line in js.splitlines():
        m = re.match(r"\s*'([^']+)':\s*\{\s*$", line)
        if m:
            city = m.group(1)
            front[city] = {}
            continue
        if city:
            pairs = re.findall(r"'([^']+)':\s*'(\d{3})'", line)
            for name, code in pairs:
                front[city][name] = code
            if line.strip().startswith("}"):
                city = None

    check("前端解析得出 22 個縣市", len(front) == 22, str(len(front)))
    total = sum(len(d) for d in front.values())
    check("前端也是 368 個區", total == 368, str(total))
    check("兩份表逐筆相同", front == zipcode.CITY_DISTRICTS,
          "只改了一邊")

    for city_name in zipcode.OUTLYING_CITIES:
        check(f"前端也知道 {city_name} 是離島", f"'{city_name}'" in js)


def test_wired_into_the_flow():
    print("\n[有真的接上流程]")
    logistics = (ROOT / "backend/app/routers/logistics.py").read_text("utf-8")
    check("建物流單前會自己查", "zipcode.lookup(order.receiver_address)" in logistics)
    check("查到會存回訂單", "order.receiver_zipcode = found" in logistics,
          "不存的話每次重試都要重算，託運單上也印不出來")
    check("查不到會擋下來並說明", "zipcode.describe(order.receiver_address)" in logistics)
    check("寄件人的也會自動查", 'zipcode.lookup(cfg.get("sender_address")' in logistics)
    check("綠界的英文錯誤有翻譯", "ReceiverZipCode" in logistics
          and "收件人郵遞區號是空的" in logistics)

    orders = (ROOT / "backend/app/routers/orders.py").read_text("utf-8")
    check("下單當下就先算一次", "zipcode.lookup" in orders,
          "等到建單才算的話，訂單列表上會一直看不到郵遞區號")

    cart = (ROOT / "frontend/src/pages/Cart.jsx").read_text("utf-8")
    check("結帳頁打地址就帶出", "lookupZip(value)" in cart)
    check("客人自己改過就不覆蓋", "zipTouched" in cart,
          "大樓、眷村改編的實際郵遞區號跟行政區對照不一樣，客人填的比較準")
    check("會員帶出的地址也會算", "lookupZip(address)" in cart)
    check("送出前會擋", "看不到縣市與區" in cart)
    check("離島會擋", "isOutlying(form.receiver_address)" in cart)


if __name__ == "__main__":
    print("=" * 60)
    print("郵遞區號測試")
    print("=" * 60)

    for fn in (
        test_every_district_resolves, test_duplicate_district_names,
        test_real_and_messy_addresses, test_gives_up_rather_than_guessing,
        test_outlying_islands, test_frontend_table_matches_backend,
        test_wired_into_the_flow,
    ):
        fn()

    print("\n" + "=" * 60)
    if failures:
        print(f"{passed} 項通過，{len(failures)} 項失敗：")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print(f"全部 {passed} 項測試通過")
