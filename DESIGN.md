---
name: 黃家基蜜
description: 基隆七堵自家蜂場的官網與網路商店——整個網站是一張攤開的蜂蜜標籤
colors:
  coral: "#ED715A"
  coral-text: "#B8402A"
  honey: "#FAC23E"
  honey-deep: "#F0AE1E"
  sky: "#9AD6E7"
  lime: "#E9EA6D"
  bloom: "#F8F6B6"
  stamen: "#EA551A"
  leaf: "#72BC4A"
  forest: "#318653"
  olive: "#A29921"
  bark: "#7F6929"
  ink: "#241916"
  ink-2: "#5C4D45"
  paper: "#FFFDF8"
  tint: "#FCFADE"
  rule-soft: "rgba(36, 25, 22, 0.16)"
  field-border: "#8C7D73"
  red: "#C8303A"
  red-deep: "#9F1F28"
  red-tint: "#FBE8E9"
typography:
  display:
    fontFamily: "Noto Serif TC, Noto Serif CJK TC, Source Han Serif TC, PMingLiU, serif"
    fontSize: "clamp(2.625rem, 0.9rem + 4.7vw, 4.75rem)"
    fontWeight: 900
    lineHeight: 1.16
    letterSpacing: "0.06em"
  headline:
    fontFamily: "Noto Serif TC, Noto Serif CJK TC, Source Han Serif TC, PMingLiU, serif"
    fontSize: "clamp(2.125rem, 1.35rem + 2.8vw, 3.5rem)"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.12em"
  title:
    fontFamily: "Noto Serif TC, Noto Serif CJK TC, Source Han Serif TC, PMingLiU, serif"
    fontSize: "clamp(1.75rem, 1.25rem + 1.9vw, 2.75rem)"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "0.1em"
  title-sm:
    fontFamily: "Noto Serif TC, Noto Serif CJK TC, Source Han Serif TC, PMingLiU, serif"
    fontSize: "clamp(1.1875rem, 1.05rem + 0.6vw, 1.5rem)"
    fontWeight: 900
    lineHeight: 1.4
    letterSpacing: "0.08em"
  product-name:
    fontFamily: "Noto Serif TC, Noto Serif CJK TC, Source Han Serif TC, PMingLiU, serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.55
    letterSpacing: "0.03em"
  lead:
    fontFamily: "Noto Sans TC, Noto Sans CJK TC, Source Han Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "clamp(1.0625rem, 1rem + 0.3vw, 1.25rem)"
    fontWeight: 500
    lineHeight: 1.75
  body:
    fontFamily: "Noto Sans TC, Noto Sans CJK TC, Source Han Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: "Noto Sans TC, Noto Sans CJK TC, Source Han Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 900
    lineHeight: 1.25
    letterSpacing: "0.08em"
  button:
    fontFamily: "Noto Sans TC, Noto Sans CJK TC, Source Han Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.06em"
  price:
    fontFamily: "Noto Sans TC, Noto Sans CJK TC, Source Han Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 900
    lineHeight: 1.2
    fontFeature: "tnum"
rounded:
  none: "0px"
  field: "6px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"
  section: "clamp(64px, 8vw, 120px)"
  gutter: "clamp(16px, 4vw, 40px)"
  container: "1240px"
components:
  button-primary:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.honey-deep}"
    textColor: "{colors.ink}"
  button-primary-on-honey:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.honey}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "48px"
  sticker:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 14px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 18px"
    height: "40px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  series-switch:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px 0 11px"
    height: "40px"
  series-switch-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.bloom}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.field}"
    padding: "11px 14px"
    height: "48px"
  trace-tag:
    backgroundColor: "{colors.bloom}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "7px 12px 8px"
  front-face:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "clamp(20px, 3vw, 40px)"
  info-face:
    backgroundColor: "{colors.honey}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "clamp(24px, 3.2vw, 44px)"
  label-table-row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "11px 16px"
---

# Design System: 黃家基蜜

## Overview

**Creative North Star: "攤開的蜂蜜標籤"**

前台的世界就是店家自己的瓶身標籤。紅淡比花系的標籤正面是珊瑚紅，上面有放大的開花枝條、一隻蜜蜂、直排的「KEELUNG SPECIALTY」；右邊的資訊面是蜂蜜黃，印著品名、注意事項的 ◎ 和一張有框的營養標示。網站把這張標籤攤開：主視覺是正面，資訊帶是資訊面，商品頁、故事每一章都是「圖的一面＋字的一面」接在一起的標籤。插畫、Logo（基隆地圖開成的花＋蜜蜂）、品牌字全部從店家的 Illustrator 完稿拆出來，用向量原檔，不另外畫、不找替代字體。

畫面是平塗的印刷品：整片鋪滿的色面、直角的面與照片、墨色細線、膠囊形的模切貼紙。唯一的立體感來自「貼上去的東西」——溯源圓貼紙、即將推出貼紙、斜放在墨色桌面上的兩張標籤。動態集中在一個時刻：首頁開場時枝幹由下往上長出來、花一朵朵開、蜜蜂沿弧線飛進來、溯源貼紙貼上。客人也可以把主視覺換成另一張標籤（鴨腳木）：新的那一面像貼上一張新標籤，從左緣一路蓋過去，花再長一次。商品照與蜂場照保持原色，不加濾鏡。

拒絕：奶油底＋明體＋金色＋六角蜂巢的模板（GitHub 原版）、自己另配顏色的風格（第一版產地紙箱、第二版孔版印刷）、白底精品風、任何不是標籤上的米色或灰色底。

**Key Characteristics:**
- 顏色全部來自標籤完稿；整段鋪滿，一段就是標籤的一個面
- 紅淡比＝珊瑚紅＋蜂蜜黃；鴨腳木＝天空藍＋檸檬黃綠，花系的顏色有意義
- 中文標題思源明體 900、字距拉開；品牌字是標籤上的向量字
- 面、照片、表格是直角；按鈕、篩選、貼紙是膠囊
- 資訊照標籤的樣子排：有框的營養標示表、◎ 開頭的注意事項
- 一個招牌動態（開花＋蜜蜂飛進來＋貼紙貼上；主視覺換花系時新標籤從左緣蓋過去、花再長一次），其餘只有按下回饋與淡入

## Colors

標籤印刷的平塗色：兩組花系色（珊瑚紅＋蜂蜜黃、天空藍＋檸檬黃綠）、插畫的花葉枝色、墨，以及閱讀頁面的紙白。

### Primary
- **紅淡比珊瑚紅 Cleyera Coral** (#ED715A)：紅淡比標籤的正面。首頁主視覺、聯絡帶、商品頁照片那一面、商品與聯絡的頁名、團購頁的團購組合、手機抽屜選單。上面的字一律墨色（5.8:1）；白字在珊瑚紅上只有 2.95:1，不用。
- **小字珊瑚 Coral Text** (#B8402A)：白底上的小字珊瑚（5.5:1）：分類名稱、文字連結、目前所在頁的選單字、常見問題的 Q。不放在色面上。
- **蜂蜜黃 Honey** (#FAC23E)：紅淡比標籤的資訊面，也是主要按鈕。首頁資訊帶與團購帶、商品頁資訊面、故事每一章的文字面、訂購須知、團購頁頁名、溯源圓貼紙、會員卡、直排的 KEELUNG SPECIALTY。滑過時用深蜂蜜黃 (#F0AE1E)。

### Secondary
- **鴨腳木天空藍 Schefflera Sky** (#9AD6E7)：鴨腳木標籤的正面。現在出現在鴨腳木的標籤圖上，以及客人把首頁主視覺切到鴨腳木時的整片底；之後鴨腳木商品上架，品名有「鴨腳木」的商品頁會自動用這個顏色當照片那一面。
- **檸檬黃綠 Lime** (#E9EA6D)：鴨腳木標籤的資訊面與它的直排字（主視覺切到鴨腳木時，KEELUNG SPECIALTY 換成這個顏色，跟標籤一樣）。用法同上，只給鴨腳木。

### Tertiary
- **花白 Bloom** (#F8F6B6)：花瓣的顏色。墨色面上的字（系列帶、頁尾、品牌故事頁名、LINE 聯絡框）、新聞報導頁名的整片底、食用注意框、選中的選項。
- **花蕊橘 Stamen** (#EA551A)、**葉綠 Leaf** (#72BC4A)、**深綠 Forest** (#318653)、**枝幹 Bark** (#7F6929)、**橄欖 Olive** (#A29921)：插畫自己的顏色，留在插畫裡。例外只有狀態：「已出貨」標籤用葉綠，成功訊息的框用深綠。

### Neutral
- **墨 Ink** (#241916)：標籤上所有的字與線。內文、標題、結構線（營養標示的框）、墨色按鈕；整片的底只用在系列帶、品牌故事頁名、聯絡頁的 LINE 框與頁尾。
- **次要墨 Ink 2** (#5C4D45)：白底上的次要文字（8:1）。色面上一律改用墨。
- **紙白 Paper** (#FFFDF8)：閱讀與操作頁面的底（購物車、會員、登入、政策、新聞內文），也是色面上的卡片底。
- **花白淡 Tint** (#FCFADE)：花白調淡，給表頭、停用欄位、照片載入前的佔位色塊。
- **淡線 Soft Rule** (rgba(36, 25, 22, 0.16))：淡一點的墨，表格列與清單分隔；放在任何色面上都還是墨色。
- **欄框 Field Border** (#8C7D73)：輸入框與篩選晶片的框（白底上 3.9:1）。
- **警示紅 Red** (#C8303A／深 #9F1F28／淡 #FBE8E9)：只給錯誤、刪除與缺貨警告；放在蜂蜜黃上時用深紅。

### Named Rules
**The Series Color Rule.** 紅淡比＝珊瑚紅正面＋蜂蜜黃資訊面；鴨腳木＝天空藍正面＋檸檬黃綠資訊面。講某一種蜜的地方就用那個花系的兩個顏色和那個花系的花；現在賣的都是紅淡蜜，所以天空藍與檸檬黃綠只出現在鴨腳木標籤上，和客人自己切到鴨腳木的主視覺。主視覺預設是紅淡比；切換只換主視覺，其他段落與頁面照各自內容的花系。
**The No-Cream Rule.** 標籤上沒有米色也沒有灰底。淺色一律從花白來（花白、花白淡），整段的底只能是紙白或標籤上的顏色。
**The Ink-On-Faces Rule.** 色面上的字一律是墨（墨色面上是花白）；次要文字也不換成灰。黃色按鈕放在蜂蜜黃面上時改成墨底黃字。

## Typography

**Display Font:** Noto Serif TC 思源明體（後備 Noto Serif CJK TC、Source Han Serif TC、新細明體）
**Body Font:** Noto Sans TC 思源黑體（後備 Noto Sans CJK TC、Source Han Sans TC、蘋方、微軟正黑體）
**Brand Lettering:** 標籤完稿拆出來的向量字（KEELUNG SPECIALTY、基隆特產、黃家基蜜、Huang's Keelung Honey、100% Natural Forest Product、花系標題與 Series 字），用 CSS mask 依底色上色。

**Character:** 粗重、字距拉開的明體，像標籤上「黃 家 基 蜜」那樣一個字一個字站好；內文用黑體，安靜好讀。品牌字永遠是標籤上那一套。

### Hierarchy
- **Display**（900, clamp(2.625rem, 0.9rem + 4.7vw, 4.75rem), 1.16, 字距 0.06em）：只給首頁主視覺兩行大標，每行不斷；手機改成 min(10.6vw, 3.25rem)。
- **Headline**（900, clamp(2.125rem, 1.35rem + 2.8vw, 3.5rem), 1.2, 字距 0.12em）：內頁頁名。
- **Title**（900, clamp(1.75rem, 1.25rem + 1.9vw, 2.75rem), 1.25, 字距 0.1em）：區段標題、團購帶與聯絡帶標題、故事章名、「森林野花蜜」（0.16em）。
- **Title Small**（900, clamp(1.1875rem, 1.05rem + 0.6vw, 1.5rem), 1.4, 字距 0.08em）：◎ 承諾標題、步驟標題、訂購須知小標。
- **Product Name**（700, 1.125rem, 1.55, 字距 0.03em）：商品卡上的品名；商品頁品名 clamp(1.75rem, 1rem + 1.5vw, 2.5rem)，讓括號裡的規格整段放得進一行。
- **Lead**（500, clamp(1.0625rem, 1rem + 0.3vw, 1.25rem), 1.75）：標題下的說明文。
- **Body**（400, 1rem, 1.8）：內文；故事與商品介紹 1.0625rem、行高 1.9。
- **Label**（900, 0.8125rem, 字距 0.08em）：貼紙、溯源標籤的抬頭、表格的項目名（700）。
- **Price**（900, 1.375rem, 等寬數字）：價格、數量、日期、追溯編號一律等寬數字；商品頁價格 2.375rem。

### Named Rules
**The Label Lettering Rule.** 品牌字只用標籤完稿拆出來的向量檔，不用任何字體重打；要換顏色就換 mask 的底色。
**The Spaced Serif Rule.** 中文標題用思源明體 900，字距 0.06em–0.16em，越短的標題拉得越開。
**The Phrase Break Rule.** 全站 word-break: keep-all，中文以分句換行；後台來的文字經過 prose()：超過 12 個字的長分句在詞與詞之間放換行點，全形左括號前也放，「（700g 經典大瓶裝）」整段一起換行，句尾標點不會被擠到行首。

## Layout

內容寬 1240px，左右留白 clamp(16px, 4vw, 40px)；版面用 12 欄格線。段落上下留白 clamp(64px, 8vw, 120px)，同為白底的相鄰兩段用一條 2px 墨線分開、上方留白縮成 clamp(24px, 3vw, 40px)。色面一律滿版鋪到螢幕邊緣。

標籤的兩面是主要的版型：左邊是圖（照片或插畫）、右邊是字，兩面直接接在一起、等高、中間沒有縫——首頁資訊帶（蜂場照＋營養標示表與 ◎ 承諾）、商品頁（珊瑚紅照片面＋蜂蜜黃資訊面）、故事每一章（照片＋蜂蜜黃文字面，左右交錯）。照片在這種版型裡填滿高度裁切，不用原始比例撐高。

首頁順序照故事走：珊瑚紅主視覺 → 蜂蜜黃資訊帶 → 墨色的森林野花蜜（兩張標籤）→ 白底精選蜂蜜 → 蜂蜜黃團購帶 → 故事、消息 → 珊瑚紅聯絡帶 → 墨色頁尾。

斷點：1100（選單縮小、直排字欄變窄）、1000（主選單收進抽屜、主視覺改成上下排：插畫在上往右出血、直排字貼左緣、大標在下；標籤兩面改成上下滿版）、820（手機尺寸、商品兩欄）、620（頂部細條收起、資訊表與表單一欄、聯絡帶的花與蜂移到底部）、560（食品標示表改成上下堆疊）、380。

### Named Rules
**The Two-Face Rule.** 圖的一面和字的一面要接在一起、等高，像同一張標籤；不在兩面之間留縫，也不把它們做成兩張分開的卡片。

## Elevation & Depth

整體是平的印刷品：色面、照片、表格、卡片都沒有陰影。深度只屬於「貼上去的東西」：模切的貼紙、溯源圓貼紙、斜放在墨色桌面上的標籤，用帶位移的柔和陰影表示它們離開紙面一點點。

### Shadow Vocabulary
- **貼紙 Sticker** (`box-shadow: 0 6px 14px -8px rgba(36, 25, 22, 0.55)`)：即將推出、團購、最省運費這些膠囊貼紙與商品卡的徽章。
- **溯源圓貼紙 Seal** (`filter: drop-shadow(0 10px 14px rgba(36, 25, 22, 0.32))`)：主視覺上的圓形溯源貼紙。
- **桌上的標籤 Label on Ink** (`box-shadow: 0 26px 44px -24px rgba(0, 0, 0, 0.75)`)：森林野花蜜那兩張斜放的標籤。
- **頁首 Header Scrolled** (`box-shadow: 0 10px 24px -18px rgba(36, 25, 22, 0.5)`)：捲動之後的頁首。
- **浮起 Float** (`box-shadow: 0 18px 48px -12px rgba(36, 25, 22, 0.5)`)：提示訊息、工作人員的編輯視窗。

### Named Rules
**The Stuck-On Rule.** 只有貼上去的東西有陰影；面、照片、表格、卡片永遠是平的。

## Shapes

三種形：直角、膠囊、圓。標籤的面、照片、表格、卡片、色塊是直角（0px）；按鈕、篩選、貼紙、狀態標籤、數量選擇器是膠囊（999px），像模切貼紙；輸入框與溯源小標籤 6px；溯源貼紙與團購步驟的數字是圓。資訊用一圈 1.5px 墨色細框圍起來、內部 1px 細線分列，照標籤上營養標示的樣子；墨色面上的框改用花白。

## Components

### Buttons
- **Shape:** 膠囊（999px），2px 框，高 48px（大 56px、小 38px），左右 24px。
- **Primary:** 蜂蜜黃底、墨字、墨框；每個畫面只有一個主要動作（選購蜂蜜、加入購物車、前往付款）。放在蜂蜜黃面上（資訊帶、團購帶、商品資訊面、團購頁頁名）改成墨底蜂蜜黃字。
- **Hover / Focus:** 滑過換深蜂蜜黃、箭頭往右 3px（只在有滑鼠的裝置）；按下縮成 0.97；focus 是 2px 墨色外框、間距 3px（墨色面上換蜂蜜黃）。
- **Outline / Ink:** 框線按鈕是透明底墨框，滑過變墨底；墨色面上框線與字改成花白。墨色實心按鈕給珊瑚紅面上的主要動作（查看聯絡方式、回到首頁）。

### Chips
- **Style:** 膠囊、高 40px、紙白底、1.5px 欄框、700 字。
- **State:** 選中是墨底紙白字；滑過換花白底墨框。

### Series Switch（花系切換）
- **Style:** 主視覺大標上方兩顆膠囊按鈕「紅淡比｜鴨腳木」：高 40px、1.5px 墨框、透明底、700 字、字距 0.1em；前面一個 14px 圓點，填那個花系標籤正面的顏色（珊瑚紅／天空藍）。
- **State:** 選中的是墨底花白字（`aria-pressed="true"`，不能再按）；滑過沒選的換 10% 墨色底（只在有滑鼠的裝置）；按下縮成 0.97。鴨腳木的插畫還在下載時，圓點變成轉圈的環（`aria-busy`），下載好才換；下載失敗就回到原樣，再按一次會重新下載。
- **Behavior:** 切到鴨腳木：整片換天空藍、直排字換檸檬黃綠、插畫換鴨腳木的花再長一次；「選購蜂蜜／團購方案」換成「即將推出」貼紙＋上市時間（後台有填才顯示，沒填時只有工作人員看到「待填」）。這一排跟大按鈕一樣高，兩種花系的主視覺尺寸完全一樣：插畫也用同一個舞台框（照紅淡比的長寬比，鴨腳木等比縮進去、靠右下），切換時大標和按鈕都不會動。鴨腳木的插畫是另外的靜態檔，滑鼠移到按鈕上、或開場播完瀏覽器閒下來時才下載。

### Cards / Containers
- **Corner Style:** 直角。
- **Background:** 白底頁面上的商品卡沒有底色（照片＋品名＋細線＋價格）；放在色面上（團購帶、團購組合）的卡片墊紙白，團購頁只有一個方案時的橫式大卡加 1px 墨框。
- **Shadow Strategy:** 無（見 Elevation & Depth）。
- **Border:** 價格上方一條 1px 墨線。
- **Internal Padding:** 色面上的卡片 14–32px。

### Inputs / Fields
- **Style:** 紙白底、1.5px 欄框、6px 圓角、高 48px；手機字級至少 16px，避免 iOS 自動放大。
- **Focus:** 框線換墨色，外加 3px 半透明蜂蜜黃光暈。
- **Error / Disabled:** 錯誤用警示紅框與字；停用是花白淡底、次要墨字。

### Navigation
- **Style:** 紙白頁首，思源黑體 1rem；所在頁是小字珊瑚 700，底下一條 2px 珊瑚紅線；滑過時線從中間長出來（200ms）。頂部一條墨色細條放標語與訂購專線。
- **Mobile:** 1000px 以下收進右側抽屜：一張珊瑚紅的面，明體 900 大字選單、蜂蜜黃圓點標示所在頁，從頁首底下滑出（300ms）。

### Label Table（營養標示表）
首頁三項事實、花系的品名表、商品頁的食品標示都用同一種表：一圈 1.5px 墨框、左邊項目（700）、右邊數值，1px 細線分列；首頁的數值是 1.5rem 明體 900。食品標示是紙白底、標題「食 品 標 示」置中拉開字距，下面一條墨線。

### Info Face（資訊面）與 ◎ Notes
蜂蜜黃的資訊面，字一律墨色。條列的承諾與注意事項每一則用 ◎ 開頭（SVG 畫的雙圈，不用文字符號），標題是 Title Small、下面一行說明。

### Trace Seal（溯源圓貼紙）
主視覺插畫左下角斜貼的圓形貼紙：蜂蜜黃圓、外圈一圈環狀文字「農業部溯源追溯編號・每一瓶都查得到生產者是誰・」、內圈墨線、中間是追溯編號與箭頭，點了開農業部查詢頁。手機放在插畫左下、不壓到直排字。

### Trace Tag（溯源小標籤）
商品頁價格旁、頁尾：6px 圓角、1.5px 框、上一行小標「農業部溯源追溯編號」、下一行編號＋外連箭頭；花白底（商品資訊面上紙白），頁尾是花白框線、透明底。

### Sticker（貼紙）
膠囊、斜 −6°（即將推出是 +8°、2px 墨框）、900 小字、蜂蜜黃底（資訊面上換珊瑚紅）、柔和位移陰影。

### Hero Bloom（主視覺開場）
招牌動態，每次開網站一次、字體載入之後才開始：枝幹由下往上長出來（clip-path，900ms）→ 葉子展開 → 花苞冒出 → 花一朵朵開（輕微回彈）→ 蜜蜂從右上沿弧線飛進來（水平 ease-out＋垂直 ease-in-out，翅膀拍動）→ 停好後上下輕晃兩次 → 溯源貼紙貼上。桌機另有很輕的滑鼠視差（只在有滑鼠、沒有設定減少動態時）。設定減少動態時直接顯示完成的畫面。

換花系時同一段動畫再播一次，所有時間乘上 `--t`（開場 1，切換 0.55），溯源貼紙不重貼。換色不做底色漸變（珊瑚紅漸變到天空藍中間會變灰），也不用圓形擴散（那是一般 App 切深色模式的效果，標籤沒有圓弧的邊）：用 View Transitions 把舊畫面定格，新的那一面從左緣（直排字那邊）用直的邊一路蓋過去（clip-path inset，640ms，ease-drawer），像貼上一張新標籤；切換按鈕在左半邊，約 70ms 就換到。新畫面是即時的，所以花照樣在長；換的那一下按鈕不做顏色過渡（不然會拍到糊掉的字）。瀏覽器不支援或設定減少動態時直接換。

### Series Labels（森林野花蜜）
墨色桌面上斜放的兩張標籤（−1.4°、+1.2°），捲到時由下往上貼上去，鴨腳木最後蓋上「即將推出」貼紙。介紹文字與鴨腳木的上市時間由店家在後台填，沒填時客人看不到空白，工作人員才看到「待填」。

### Buy Bar（購買列）
商品頁捲過「加入購物車」那一排之後，底部滑上來一條紙白購買列（上緣 1.5px 墨線、規格、價格、按鈕），電腦與手機都有。

## Do's and Don'ts

### Do:
- **Do** 用標籤上的顏色整段鋪滿，一段就是標籤的一個面；閱讀與操作的頁面用紙白 (#FFFDF8)。
- **Do** 講哪一種蜜，就用那個花系的兩個顏色和那個花系的花（紅淡比：#ED715A＋#FAC23E；鴨腳木：#9AD6E7＋#E9EA6D）。
- **Do** 把圖的一面和字的一面接在一起、等高，做成一張標籤。
- **Do** 用有框的營養標示表排事實與規格（1.5px 墨框、1px 細線分列）。
- **Do** 色面上的字一律用墨 (#241916)；蜂蜜黃面上的主要按鈕改成墨底黃字。
- **Do** 品牌字、Logo、插畫只用標籤完稿拆出來的向量檔。
- **Do** 商品照與蜂場照保持原色。
- **Do** 缺的資料寫「待填」，只讓工作人員看到；客人看到的永遠是完整的畫面。

### Don't:
- **Don't** 用米色、灰色或任何標籤上沒有的底色當整段的底。
- **Don't** 用天空藍或鴨腳木的花去框紅淡蜜的商品或團購。
- **Don't** 在珊瑚紅上放白字（只有 2.95:1）。
- **Don't** 給面、照片、表格或卡片加陰影；陰影只屬於貼上去的貼紙與標籤。
- **Don't** 在標題上方放英文小字，或把事實排成「大數字＋小標籤」的數據條。
- **Don't** 用文字符號或表情符號當圖示（◎、箭頭都用 SVG 畫）。
- **Don't** 加第二個開場動畫；招牌動作只有主視覺開花與標籤貼上。換花系是同一段開花再播一次，加上新標籤從左緣蓋過去的換面。
- **Don't** 用底色漸變或圓形擴散在兩個花系之間轉場（漸變中間會變灰；圓形是一般 App 的效果）；新的一面用直的邊從左緣蓋過去。
- **Don't** 寫「產銷履歷」（用「溯源」）、「開立發票」（用「農民收據」）、「第幾代養蜂」、「定期送驗」。
