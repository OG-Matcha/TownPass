# 捷伴：一路有聲，出站無礙（捷運無障礙微服務）

> 城市通 App 端（含本微服務打包版、找服務、輔助使用）：https://github.com/OG-Matcha/TownPass/tree/feat/mrt-service ・ 線上版：https://codefest-mrt.jushenhuang-jason.workers.dev

## 授權（AGPL-3.0）

本作品為「2026 臺北秋季程式設計節－城市通微服務大黑客松」參賽作品，依競賽須知「智慧財產聲明」以 AGPL-3.0 授權，並無償、不可撤銷授權主辦單位及其所屬機關使用；自公布得獎結果日起一年內保持公開、不下架。全文見 [LICENSE](../../LICENSE)。

```
捷伴：一路有聲，出站無礙 — accessible MRT companion, voice service search and accessibility layer for the TownPass app
Copyright (C) 2026 捷伴 contributors (OG-Matcha, Applause0219, KevensDreamLand, YUEYUE14)

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
```


嵌在城市通裡的微服務。手被佔住、身體不方便的那一刻（坐輪椅、推嬰兒車、打石膏、懷孕、推著長輩輪椅的看護）也能搭捷運：出門前知道整趟哪裡有電梯、今天有沒有保養；路上一次只看下一步，可以用講的、單手按、自動念出來；卡住時先找得到人。

**操作設定「現在哪裡不方便」**（可複選、隨時改）：手不穩按不準 → 下一步變整片大按鈕；只有一隻手 → 操作列縮到拇指側（左右手可選）；兩隻手都在忙 → 每念完一步自動聽一句；不方便看螢幕 → 自動念、快到站主動提醒（依時間表，不靠地下不準的 GPS）、長按螢幕任何地方 1 秒換步（防口袋誤觸：要按住不動、比預計早很多會先問、換步可復原）；不方便講話 → 隱藏「用講的」。第一次打開就問一次，之後在「字級・操作」改。

**用講的**：按下有提示音與震動、全幅「正在聽」，聽到先複述再執行並念出結果；聽不懂會反問。路上指令：下一步、再說一次、找不到電梯、放大、上一步、暫停、繼續、結束（要再確認）。中文意圖由裝置端模型判斷（見「裝置端模型」），印尼語與模型未載入時用規則。念出來的話另外寫口語稿（`src/lib/spoken.ts`，每段 ≤ 40 字、不念符號）。

**一鍵**：常走路線卡「今天出發」1 下就上路；說「帶我去北美館」「跟上次一樣」直接規劃（`src/lib/homeIntent.ts`）。

**看護模式**：路上畫面可切印尼語（`src/lib/i18n.ts`）；站名與出口編號維持中文對照現場指標；給站務人員的求助卡維持中文。印尼語由團隊撰寫，**尚未經母語者校對**。

收斂紀錄與證據見 `docs/ideation/03_用不了_收斂.md`（砍掉探索活動、方案比較只在有問題時出現）。

1. **首頁五秒看出為誰做**：大標題寫出對象；字級・對比在最上面；**我的常走路線**（查過就記在這支手機）每張卡寫今天的判定與接下來 30 天最近一次白天保養，一鍵看今天；下面是從哪站到哪站＋用講的。不問身分、不用登入
2. **選站可以打地點名**：例如「台大醫院」→ 帶出離它最近的電梯／坡道出口與車站（團隊查核的市府場館與服務 11 筆）
3. **結果最上面大字判定**：「今天這趟：沒有排定電梯保養」或「⚠ 有 N 個地方要注意」，寫資料時間、不含臨時故障。**有問題才給替代**（改從鄰站、其他走法），沒問題不列方案比較
4. **每站一句**：從幾號出口（電梯）進出站、輪椅停靠車廂、開門側；出站動線從月台往出口寫；轉乘站開放資料沒有轉乘動線 → 寫「沿無障礙指標找電梯，或按電梯旁對講機、問詢問處」，不套用進出站動線
5. **傳給家人（文字）**：只傳這趟摘要，不用開追蹤。選其他日子 → 不開始行程，記在常走路線，當天打開首頁就看得到
6. **路上：下一步卡片**：一次一段，大字指示＋這站電梯狀況＋「唸給我聽」，底部大按鈕「我到了，下一步」
7. **找不到電梯 → 求助階梯**：這站有電梯的出口、無障礙閘門（服務鈴）、電梯動線 → 給站務人員看的求助卡（寫現在在哪站、要做什麼）→ 北捷客服 → 有分享時本人滑動確認才通知家人
8. **分享給家人是選用的**：本人按「開始分享」才上傳，只分享到了哪一站；比預計晚會先問本人，3 分鐘沒回應或本人確認才讓家人頁變紅

## 怎麼跑

```bash
npm install
npm run fetch:data           # 抓 data.taipei → public/data/*.json（不開 CORS、評審可能斷網，建置時抓好打包）
npm run dev                   # http://localhost:5173/      加 ?demo=1 會出現「時間快轉」按鈕（示範分享行程用）
npm run build                 # dist/ 用相對路徑，可打包進 App 離線使用
```

## 檢查（都要先 `npm run dev`）

| 指令 | 檢查什麼 |
|---|---|
| `npm run check` | 下面全部 |
| `npm run check:offline` | 擋掉網頁主機以外的連線（模擬關網路）：路線規劃可用、底圖從本機圖磚載入、放大到本機沒有的層級仍有底圖 |
| `node scripts/cloud-check.mjs` | 正式站：兩個不共用儲存的瀏覽器模擬兩支手機，求助要出現在家人頁；拿到連結的人寫入要被拒（403） |
| `npm run a11y` | axe-core（WCAG 2.2 AA ＋ AAA 對比 7:1）＋ 360px 寬不可橫向捲動 ＋ 觸控目標 ≥ 64px；三種字級 × 首頁（空白、常走路線）／選站與地點搜尋／三種結果／步驟卡與分享／詢問／求助階梯／求助卡／家人頁／高對比 |
| `npm run check:behavior` | 按偏偵測、表單提示、選站、打字指令、轉乘與出站動線、步驟卡、選用分享、求助階梯、滑動確認、常走路線、地點搜尋、有問題才給替代、其他日子不開始行程、高對比（65 項） |
| `npm run check:unit` | 語音指令解析（17 句）、行程時間表與求助階梯（11 項）、分享後端權限（7 項）、路線規劃範例 |

## 功能與檔案

| 功能 | 檔案 | 說明 |
|---|---|---|
| 路線規劃 | `src/lib/route.ts` | 站間行駛時間＋轉乘步行時間，Dijkstra；轉乘步行一律 ×1.5（估計值，畫面有標示） |
| 單站狀況 | `src/lib/station.ts` | 無障礙出入口、出發日保養、異常公告、附近替代站 |
| 站內設施 | `public/data/facilities.json` | 輪椅停靠車廂、開門方向、無障礙閘門、廁所、電梯動線（136/136 站×路線） |
| 字級・對比 | `src/lib/settings.ts`、`components/DisplaySettings.vue` | 字級標準／大／特大 = 根字級 16／20／24px，只放大文字（間距、觸控目標固定 px）；高對比模式（黑白、粗框）。收在「字級・對比」二級入口，存在裝置上 |
| 朗讀 | `src/lib/speech.ts` | 每一步旁邊有「唸這一步」，步驟卡有「唸給我聽」，點了才念，語速 0.85；App 內交給原生 TTS handler `tts`（WebView 沒有 speechSynthesis） |
| 滑動確認 | `components/SlideConfirm.vue`、`CallButton.vue` | 撥電話、通知家人要滑到底（95%）；鍵盤／讀屏用按鈕替代（WCAG 2.5.7） |
| 按偏偵測 | `src/lib/missTap.ts` | 點在按鈕外 24px 內或同一顆 600ms 內連點，30 秒內 3 次 → 問「要不要放大」，同意才改 |
| 用講的 | `src/lib/voiceCommand.ts`、`voiceInput.ts` | 規則解析（不用模型）；App 內走裝置端辨識 handler `speech_to_text`（team-repo 分支 `feat/speech-to-text-handler`），也可以打字。收在「用講的」二級入口 |
| 首頁與常走路線 | `src/views/HomeView.vue`、`src/lib/planner.ts`（`savedRoutes`、`checkRoute`） | 查過的路線記在這支手機，依次數排序；判定只看預排保養與異常公告 |
| 地點搜尋 | `src/views/StationPicker.vue`、`src/lib/places.ts`、`public/data/places.json` | 地點資料人工查核官方網站整理（每筆有來源與查核日期）；最近的無障礙出入口用出入口座標算直線距離 |
| 下一步卡片與求助階梯 | `src/views/TripView.vue`、`planner.ts`（`stepsOf`） | 卡片和行程節點一一對應；出發當下的規劃快照存在手機，之後查別的路線不影響 |
| 畫面與路由 | `src/lib/router.ts`、`src/views/*` | hash 路由，每個畫面一筆瀏覽紀錄，城市通 AppBar 與 Android 返回鍵一步一步退 |
| 分享行程 | `src/lib/trip.ts`、`tripStore.ts`、`tripSession.ts`、`views/TripView.vue`、`FamilyView.vue` | 家人頁 `#/family/<id>`；不靠地下 GPS，用預計時間表判斷有沒有卡住 |
| 分享後端 | `worker/trip-worker.js` | Cloudflare Workers＋KV（免費方案），已部署。家人連結只能讀；寫入要旅客手機上的權杖；6 小時後自動刪除。`npm run dev` 沒設 `VITE_TRIP_API`，是本機模式（同一台裝置的分頁同步） |
| 斷網底圖 | `scripts/fetch-tiles.mjs`、`src/map/offlineTiles.ts`、`public/tiles/` | 國土測繪中心 EMAP 圖磚 1,004 張（27 MB）打包：z10–14 捷運全線、z15 出入口 1 公里、z16 出入口 400 公尺。順序：本機 → 線上 → 本機上層圖磚放大 |

## 正式站（Cloudflare，免費方案）

| | 網址 | 部署 |
|---|---|---|
| 網頁 | https://codefest-mrt.jushenhuang-jason.workers.dev | `npm run build && npx wrangler deploy`（Workers 靜態資源，設定在 `wrangler.jsonc`） |
| 分享後端 | https://codefest-trip.jushenhuang-jason.workers.dev | `cd worker && npx wrangler deploy` |

`.env.production` 設定 `VITE_TRIP_API`（後端）與 `VITE_PUBLIC_URL`（家人連結用的公開網址；App 內網頁是 localhost，家人手機打不開）。都是公開網址，不是秘密。

## 設計

城市通 Figma UI Kit 與 App 色票，為了對比度有 4 處偏離，對照表見 `docs/ideation/01_用不了_想法確認.md` 第 16 節。城市通無障礙規範（AAA 對比、64dp、語速 0.85、滑動確認、漸進揭露）的採用與偏離見第 18 節。圖示用 Lucide（ISC，打包在網頁裡、離線可用）。

## 資料來源（臺北市資料大平臺）

| 資料集 | 用途 |
|---|---|
| 臺北捷運車站出入口無障礙電梯、無障礙坡道GPS座標 | 出入口位置 |
| 臺北捷運車站電梯維修預排時程表（最近 2 個月） | 出發日保養。官方：僅為預定排程、不含臨時故障 → 文案一律寫「排定保養，以車站公告為準」，不寫「停用」 |
| 臺北捷運車站無障礙設施 | 輪椅車廂、開門方向、閘門、廁所、動線 |
| 臺北捷運車站無障礙設施異常公告 | 尚未修復的異常 |
| 臺北捷運相鄰兩站行駛時間、轉乘站步行時間 | 路線與預計時間 |
| [臺北市公私立醫院](https://data.taipei/dataset/detail?id=b02cd6b2-79be-4d7f-ae78-305b2af668f5)（衛生局） | 目的地：醫院 36 家（自帶 WGS84 座標） |
| [臺北市立聯合醫院門診進度查詢](https://data.taipei/dataset/detail?id=8ee49ff0-600b-4e5a-81b2-41f712c5c801)（衛生局） | 目的地：聯合醫院 7 個院區（和平、婦幼、忠孝、陽明、松德、林森、昆明；仁愛在 `places.json`、中興在公私立醫院資料集）。**資料集只有地址** → 建置時用 Nominatim 以官方全名查 OSM 上標為醫院的點，每筆 `coordSource` 寫明 |
| [臺北市公園基本資料](https://data.taipei/dataset/detail?id=ea732fb5-4bec-4be7-93f2-8ab91e74a6c6)（公園處；資源為公園走透透 API） | 目的地：面積 2 公頃以上的公園 57 座（813 座裡挑出；「XX號綠地」不列） |
| [臺北市立圖書館各分館暨民眾閱覽室](https://data.taipei/dataset/detail?id=43772803-6504-469c-894d-35904342a53b)（教育局） | 目的地：圖書館 65 處（已閉館的不列） |
| [臺北市各區運動中心](https://data.taipei/dataset/detail?id=80be7612-593f-4795-9935-a10ce0f7b75b)（體育局） | 目的地：運動中心 12 處。中正運動中心座標在資料集裡偏到大安區，以 `places.json` 人工查核的那筆為準 |
| [臺北市政府各機關學校聯絡資訊](https://data.taipei/dataset/detail?id=6b99dd93-9c63-43c9-96eb-0bfffce97217)（秘書處） | 目的地：12 區公所的名稱與地址。**資料集沒有座標** → 建置時用 OpenStreetMap Nominatim（ODbL）依「X區公所／X區行政中心」查 OSM 上標為公所的點；查不到的（北投、文山）退回街道中心點，每筆 `coordSource` 寫明 |

目的地地點由 `npm run fetch:poi` 抓成 `public/data/poi.json`（189 筆，每筆有 `source.dataset`、`source.url`、`checkedAt`）；和 `places.json` 重複的（台大醫院、中正區公所、市圖總館、中正運動中心）以 `places.json` 人工查核的那筆為準。每個地點最近的無障礙出入口用「出入口無障礙電梯、坡道 GPS 座標」算直線距離；陽明公園、前山公園離捷運超過 3 公里，畫面標「離捷運較遠」。

### 地名別名（縮寫詞典的公開來源）

`npm run fetch:aliases`（`scripts/fetch-aliases.mjs`）建置時抓公開資料裡的別名、簡稱，對到上面已有的捷運站與地點，存成 `public/data/aliases.json`（每筆有 `source`、`license`；靠「離捷運出入口 ≤ 400 公尺」對到車站的另記 `via: "nearest-station"` 與公尺數）。執行時離線讀檔，不連外。

| 來源 | 授權 | 用途 |
|---|---|---|
| [Wikidata](https://www.wikidata.org/)（臺北捷運車站 P16=Q714810；臺北車站方圓 16 公里有座標的條目） | CC0 1.0 | 中文標籤與別名：北車、北美館、榮總、北榮、小巨蛋、兩廳院… |
| [OpenStreetMap](https://www.openstreetmap.org/copyright)（Overpass：臺北市、新北市的車站、醫院、公園、博物館、景點等的 `short_name`／`alt_name`） | ODbL 1.0，**© OpenStreetMap contributors** | 松菸、國圖、北科大… |
| [內政部地政司 臺灣地區地名資料_具有地標意義公共設施類](https://data.gov.tw/dataset/40454) | 政府資料開放授權條款第 1 版 | 「別名」欄（AnotherName）：臺北車站＝北車、臺北市立動物園＝木柵動物園… |

手寫詞典（`placeRules.ts` 的 `SHORTCUTS`）保留且優先：手寫的 key 整句命中直接定案；公開別名整句命中則與名稱比對一起排（可能列出多筆讓人選）。151 個手寫縮寫中 30 個（20%）公開資料也有、且指到同一目標；其餘多半是「地標 → 該搭到哪一站」的判斷（故宮 → 士林站），公開資料沒有。量測見 `docs/research/15_公開地名別名資料.md`。

資料品質處理：Big5 轉 UTF-8；圓山站坡道緯度漏小數點（`fixCoord()`）；站名寫法統一（`normStation()`）；松江南京站路線欄漏寫松山新店線，改以站碼判斷；每個請求重試 4 次、分頁抓完核對總數。

## 地圖元件

`src/components/ui/map/` 複製自 [AnoRebel/mapcn-vue](https://github.com/AnoRebel/mapcn-vue) commit `04d17b2`（MIT，授權檔在同目錄）。改動：預設底圖改國土測繪中心 EMAP（CARTO 商用要授權）、刪掉 deck.gl 與 three.js 元件。

## 裝置端模型

路上說「到了」「再說一次」「找不到電梯」這類短句，由裝置端 embedding 模型判斷意圖（下一步、重複、求助、放大、上一步、暫停、繼續、結束）。**執行時不連任何雲端 API，斷網可用**。

**在城市通 App 裡只有一顆向量模型（2026-11-08 起）**：網頁改向 App 的 `embed` handler 要向量，用的是 App「找服務」已載入的 **EmbeddingGemma 2 Text 270M**（Google，Apache-2.0，int4 QAT `.litertlm`，LiteRT-LM 裝置端推論；名稱、修訂版、SHA-256 見 App repo README「裝置端 AI 揭露」）。App 不再打包下表的 e5（`scripts/sync-app.mjs` 略過 `models/`、`ort/`）。下表的 e5 只用在一般瀏覽器部署，以及沒有 `embed` handler 的舊版 App。
門檻依模型不同：意圖 e5 0.90／EmbeddingGemma 0.87；目的地 e5 0.86／EmbeddingGemma 0.93（都只用開發集選）。兩顆模型同一組題目的比較見 `docs/research/17_向量模型二選一.md`。

| 項目 | 內容 |
|---|---|
| 模型 | intfloat/multilingual-e5-small（Microsoft，約 118M 參數（含 250k 多語詞表），BERT 架構）。**是 embedding 模型，不是生成式模型；不是中國廠牌** |
| 版本 | HF `Xenova/multilingual-e5-small`（transformers.js ONNX 版）commit `761b726dd34fb83930e26aab4e9ac3899aa1fa78` |
| 量化 | int8 ONNX（`onnx/model_quantized.onnx`，transformers.js `dtype: "q8"`） |
| 推論框架 | transformers.js `@huggingface/transformers` 4.3.2（Apache-2.0）＋ onnxruntime-web wasm，單執行緒 |
| 來源 | https://huggingface.co/intfloat/multilingual-e5-small ／ https://huggingface.co/Xenova/multilingual-e5-small |
| 授權 | MIT（廠牌：Microsoft） |
| 大小 | 模型約 113 MB（`public/models/`，含 tokenizer 約 130 MB）＋ wasm 約 14 MB（`public/ort/`），全部本機提供 |
| 做法 | 範例句（`src/lib/intent.ts` 的 `EXEMPLARS`）加 `query: ` 前綴後向量化（mean pooling），取每個意圖的最高餘弦相似度；低於 0.91 回傳 `unsure` 讓介面反問（e5 分數整體偏高，門檻只用開發集選）。印尼文（拉丁字母）與模型未載入時走規則（`by: "rules"`） |

實測（`npm run dev` 後 `node scripts/intent-check.mjs`，封鎖所有非 localhost 請求）：

- 盲測集 140 句（只跑一次，未依它調參）：不設反問門檻的 top-1 為 79%；套用門檻 0.91 後 59% 正確、13 句做錯動作、44 句反問（門檻在開發集選的，轉到盲測集反問偏多）。背景閒聊多半能正確判為「none」
- 自寫開發集 59 句（`scripts/intent-dev.json`，門檻由此選出）：83% 正確、3 句做錯、7 句反問（無門檻時 93%）
- 單句延遲（PC Chrome）：中位數約 46 ms、P95 約 59 ms；CPU 節流 4 倍約 250 ms；6 倍約 415 ms、P95 約 504 ms
- 冷載入（含範例句向量化）：約 12 至 15 秒（PC，首次含 Vite 預處理）；請在開啟 App 時先 `warmIntent()`

## 目的地理解（「去一個地方」）

打字或用講的（語音辨識文字）→ `searchPlaces(q)` 回最多 3 筆，每筆附目的地車站與最近的無障礙出口。不支援門牌地址。

| 層 | 做法 | 檔案 |
|---|---|---|
| 1 縮寫詞典 | 約 180 個台灣人會講的簡稱（北車、市府、101、大巨蛋、榮總、北美館…）→ 車站或地點；歧義（台大、大安）回多筆讓人選 | `src/lib/placeRules.ts` `SHORTCUTS` |
| 2 名稱／容錯 | 臺／台同字、去掉「我要去」「帶我到」「那邊」這類口語、「從X到Y」取 Y；捷運站名、場館名、開放資料地點名與簡稱；編輯距離容錯（同音字算半個錯：台北車戰→台北車站）。字尾是「醫院／院區／分館／站」這類通用詞時只比前面的字，不在資料裡的醫院名（「新興醫院」）寧可回空也不配到別家 | 同上 |
| 3 語意 | 規則沒中才問裝置端 multilingual-e5-small（與路上意圖共用 worker）：分類目的句（看病、拿藥→醫院；借書→圖書館；辦戶籍謄本→區公所）與地點名向量化，取最近；低於門檻 0.86 回空（閒聊不會亂配）。模型沒載好或超過 2.5 秒 → 只有規則 | `src/lib/placeSearch.ts`、`src/lib/intentWorker.ts`（`index`／`nearest`） |

分類查詢（醫院、公園、區公所、圖書館、運動中心）有出發站就回離它最近的 3 筆，沒有就依等級（醫學中心、大公園優先）。

檢查：`node --experimental-strip-types scripts/place-search-check.mts`（規則層，node）、`node scripts/place-semantic-check.mjs`（整條管線，瀏覽器離線跑，含延遲）。開發集 `scripts/place-dev.json`（自寫，拿來調）；盲測集 `scripts/place-blind.json`（另一人寫，實作凍結後只跑一次，結果見下）。

實測（2026-11-08，PC Chrome，封鎖所有非 localhost 請求）：

- 盲測集 60 句（另一人寫，實作凍結後只跑一次、未依它調整）：前 3 命中 53 句（88%）。依類型：縮寫 14/18、名稱 13/14、錯字 7/8、描述目的 12/12、歧義 4/4、閒聊 3/4。漏的 7 句裡 3 句是答案本身有爭議（「大巨蛋」我們答國父紀念館站、盲測集寫忠孝復興站；「花博」答「花博公園圓山園區」、盲測集要「花博公園」；「國館」我們當國父紀念館、盲測集當台大）；真正漏的：和平醫院（醫院資料集只有聯合醫院總院一筆，容錯誤配到和信）、萬華火車站（不是捷運站，卻被「火車站」簡稱帶到台北車站）、公官（兩個字不做容錯）、「喂喂喂聽得到嗎」被語意層配到圖書館（0.91）
- **事後（post-hoc）補跑**：看過盲測集後補了聯合醫院 7 個院區與「字尾通用詞只比前面的字」容錯守門（因盲測集的「和平醫院」暴露了資料缺漏與誤配），**沒有依盲測集調參數或改簡稱**。補跑結果仍是 53/60（88%）：「和平醫院」已正確回「聯合醫院和平院區」，但盲測集的可接受寫法是「臺北市立聯合醫院和平院區」，字串沒對上，故計分未變；其餘 6 句同上
- 開發集 72 句（`scripts/place-dev.json`，門檻由此選；補跑後含聯合醫院與守門案例）：71/72。漏的「新興醫院」（不存在的醫院）規則層正確回空，但語意層把它當成「要去醫院」回了醫院分類清單（0.89），沒有配到某一家特定醫院
- 延遲：規則命中中位 0.5 ms；走到語意層中位約 90–120 ms、P95 約 150–200 ms。冷載入：分類句索引約 20–26 秒（含模型載入）、地點名索引再約 10 秒；期間只有規則層

## 還沒做

- **斷網時分享行程**：分享要網路（家人在別的手機上）。斷網時規劃、朗讀、底圖都能用，分享會失敗
- **語音實機測試**：Demo 手機要先下載中文離線語音，飛航模式下測一次
- 保養代碼 D／P／A 的實際時段、保養時是否停梯：資料沒寫，問北捷前一律保守寫法
