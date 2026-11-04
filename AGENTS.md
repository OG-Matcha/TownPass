# 隊伍 repo 守則（給 AI 開發工具與隊員）

本 repo 是 taipei-doit/TownPass 的 fork（`upstream` remote 指向官方）。結構：
- 根目錄 = 城市通 App（Flutter 3.47.6，`lib/`、`android/`、`ios/`）；改動盡量集中，方便資訊局跟上游比對整併
- `microservice/` = 微服務網頁（開賽後建立；雙向溝通封裝用 `.ai/docs/kit/tp-bridge.ts`）
- `server/` = 後端（選配）
- `.ai/` = **唯讀參考資料（git submodule），不要修改**：
  - `.ai/docs/` 官方規則、選手手冊、說明會簡報（`.ai/docs/docs/official/`）、TownPass 開發文件全站鏡像（`docs/townpass-guideline/_INDEX.md`）、研究報告（`.ai/docs/docs/research/`）、作戰手冊（`docs/作戰手冊.md`）、範本（`kit/`）
  - `.ai/taipei-gov-dev/` 臺北市府官方 AI 開發規範包：有畫面、個資、對外文字時先讀 `SKILL.md`
  - `.ai/townpass-services/` 官方 Vue 3 微服務範例（**用 Google Maps，今年禁用，不要照抄地圖部分**）

取得 submodule：`git submodule update --init --depth 1`（`.ai/docs` 是私有 repo，需隊員權限）。

- **題目方向：數位平權 × 友善共融**：「從不同族群的城市數位服務使用情境出發，思考如何降低**操作、理解與服務取得**門檻」。正式題目 3 大類，11/7 公布（出處：`.ai/docs/docs/official/說明會_競賽主題規則簡報.txt` p.3–4）
- 介面本身就是評分對象：長輩、視障、新住民、不識字者都要能用 → 大字、高對比、語音、多語、少步驟是基本盤，不是加分

## 一、硬規則（違反 = 扣分或失格）

| # | 規則 | 怎麼做 |
|---|------|--------|
| 1 | **執行時 AI 推論必須在裝置端** | 不得呼叫任何雲端 LLM／遠端模型 API。評審可能關網路現場出題。開發階段用雲端 AI 沒問題 |
| 2 | 禁用危害國家資通安全清單的 AI（含中國廠牌） | 不用 Qwen、DeepSeek、GLM、Yi、MiniCPM、InternLM 等及其衍生模型 |
| 3 | README 揭露模型 | 名稱、版本、量化格式、推論框架、來源 URL |
| 4 | 地圖用開源方案 | Leaflet / MapLibre + OpenStreetMap 或國土測繪中心圖資。**不用 Google Maps / Mapbox**（官方 Vue 範例用 Google Maps，不要照抄） |
| 5 | 套件開源、免費 | MIT / BSD / Apache-2.0 可；「僅供個人使用」「不得再散布」不可。YOLO（Ultralytics）是 AGPL，可用但要標註 |
| 6 | 作品授權 AGPL-3.0 | 公開 repo + 主辦指定授權聲明；得獎後保持公開至少一年 |
| 7 | 核心資料 = 合法開放資料並註明出處 | 非核心可用模擬資料，但 README 與 Demo 要標「模擬」 |
| 8 | 發表不得用簡報 | 只能電腦 Demo（實機畫面投影）。控台只給 HDMI |
| 9 | 免費方案部署 | Firebase Hosting / Cloud Run / Cloudflare Pages 等，須 HTTPS |

## 二、評分（決定取捨）

| 初選（2 分鐘 + 1 分鐘 Q&A，評審輪桌） | 分 | 決選（5 分鐘發表 + 5 分鐘 Q&A） | 分 |
|---|---|---|---|
| 服務應用：想法創意且符合題目 | 40 | 服務應用：情境完整且實用 | 25 |
| 視覺呈現：介面清楚美觀 | 30 | **服務完整度：落地可能性及難易度** | **30** |
| 技術完整度：架構清楚、資料正確、運作流暢 | 30 | 技術穩定度：流暢與穩定 | 20 |
| | | 視覺呈現 | 15 |
| | | 創意及公益性：開源、公益、創意、發表順暢 | 10 |

## 二之〇〇、環境地雷

- **專案路徑不能有中文**：在 `I:\黑客松\...` 跑 `dart run build_runner` 會出現 `Unable to write file ... build.dart.aot`。用 junction `I:\codefest2026`（指向本工作區）操作，隊伍 repo 也放英數字路徑
- Flutter 一律用 FVM 的 3.47.6（`~/fvm/versions/3.47.6/bin`），系統預設的 3.41.6 版本太舊

## 二之〇、開放資料地雷（詳見 `.ai/docs/docs/research/03_台北通現況_市民需求_開放資料.md`）

- **data.taipei API 只允許 data.taipei 網域跨站呼叫**，blob JSON 完全不開 CORS → 網頁前端不能直接抓，要後端代理或建置時預先抓好打包
- 部分資料是 TWD97 座標或 Big5 編碼，先轉 WGS84 / UTF-8
- TDX 沒金鑰會被拒，賽前申請
- 城市儀表板現址 citydashboard.taipei（dashboard.gov.taipei 已失效），repo：github.com/taipei-doit/Taipei-City-Dashboard
- 台北通負評主因是註冊登入卡關 → 查詢類功能不要強迫登入

## 二之一、邊緣 AI 要點（詳見 `.ai/docs/docs/research/04_邊緣AI技術方案.md`）

- 主方案：`flutter_edge_ai 2.5.5` + `flutter_edge_ai_litertlm 1.19.1`，**版本寫死不用 `^`**，比賽中不 `pub upgrade`；模型 Gemma 4 E2B `.litertlm`（約 2.58 GB，Apache-2.0）。主辦簡報寫的 2.3.2 / llamadart 0.8.19 已過時，網路與 AI 給的範例多半是舊 API
- 備案：llamadart 0.17.5 → Gemma 3 1B（584 MB）→ 不經 LLM 直接顯示 RAG 卡片
- **斷網陷阱**：評審關網路時，放在雲端的微服務網頁本身就打不開。有 AI 功能的頁面與資料要打包進 App（`InAppLocalhostServer`）或可離線
- TownPass 要改：Android `minSdk` 30（LiteRT 要求，只支援 arm64）；**main `AndroidManifest.xml` 沒有 INTERNET 權限**（只有 debug/profile 有）→ release build 連網頁都載不到，必加
- Demo 機：Android 用 Snapdragon、8 GB RAM 以上；LLM 與語音模型不要同時載入（OOM）

說明會簡報補充的評分依據：初選「具創意性、符合題目、介面清楚、操作簡單、介面美觀、系統流程順、資料來源符合規定、功能可運行」；決選「使用情境完整、可解決痛點、**資料可持續取得、成本合理、具擴充性**、執行流暢、無明顯錯誤」。

推論：**AI 不是評分項目**，是加分手段。一條主流程做穩、做漂亮 > 五個半成品功能。決選最重「能不能真的上線、資訊局接得住」。

## 三、架構

```
城市通 App（Flutter 3.47.6）──postMessage {name,data}──▶ 微服務網頁（WebView，框架不限）
   │ 內建 handler：userinfo, location, notify, qr_code_scan,          │
   │ device_info, open_link, launch_map, phone_call, 1999agree         ├──▶ 後端（選配，Cloud Run）
   │ 自訂 handler：繼承 TPWebMessageHandler，加入                         └──▶ 開放資料 data.taipei / TDX
   │ TPWebMessageListener._cachedMessageHandlers
   └─ 裝置端模型（flutter_edge_ai / llamadart，Gemma 4 E2B）
```

- 網頁 → App：`window.flutterObject.postMessage(JSON.stringify({ name, data }))`
- App → 網頁：`flutterObject.addEventListener('message', e => JSON.parse(e.data))`，用完 `removeEventListener`
- 一般瀏覽器沒有 `flutterObject` → 一律先判斷，fallback 到 mock，讓網頁能在桌面 Chrome 開發
- 新增服務入口：`lib/page/city_service/model/my_service_model.dart`（enum `MyServiceItemId` + `MyServiceIdExt` case）
- 圖示：SVG 放 `assets/svg/`（snake_case）→ `fvm dart run build_runner build --delete-conflicting-outputs`
- 切換測試身分：`assets/mock_data/account.json`（`citizen`、`birthday`）
- 設計：主色 `#5AB4C5`、輔色 `#F5BA4B`、灰 `#738995`；字 PingFang TC / Roboto；h1 36・h2 24・title 18・h3 16・body 14・caption 12；觸控目標 ≥ 48dp

## 四、工作方式

- 分支：`main` 隨時可 Demo；功能開 `feat/<人>-<功能>`，小 PR、快合併
- 每個 PR 至少一人看過；AI 產生的程式碼自己讀過一次（決選有 Q&A）
- 資料來源：AI 給的 API 網址、資料集、欄位一律 `curl` 實測後才寫進程式，並同步更新 README「資料來源」
- 新增套件：同步更新 README「第三方套件」與授權
- 問 AI 前附上 `app/pubspec.yaml`：Flutter 3.47、AGP 9、Kotlin 2.4 比訓練資料新
- Demo 前：實機飛航模式完整跑一次主流程；模型先預熱
