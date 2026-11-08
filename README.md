# 城市通友善包：捷伴・找服務・輔助使用

2026 臺北秋季程式設計節－城市通微服務大黑客松參賽作品（題目：數位平權 × 友善共融）。在城市通 App 上加三項：

- **捷伴**（我的服務 → 市政服務）：說要去哪，就給能走的捷運無障礙路線；用臺北市開放資料避開排定保養的電梯，給唯一建議出口與電梯動線圖，路上一步一步陪到出站。網頁打包在 App 內（`assets/web/mrt`），斷網可用。原始碼：https://github.com/OG-Matcha/jieban
- **找服務**：說一句話（例：「路燈壞了」）就找到對的服務，裝置端語意模型。
- **輔助使用**：每個服務網頁都有的浮動鈕，字級、高對比、左右手，可拖曳。

裝置端 AI 揭露見下方「裝置端 AI 揭露」與「語音辨識與朗讀」。

## 授權（AGPL-3.0）

本作品為「2026 臺北秋季程式設計節－城市通微服務大黑客松」參賽作品，依競賽須知「智慧財產聲明」以 AGPL-3.0 授權，並無償、不可撤銷授權主辦單位及其所屬機關使用；自公布得獎結果日起一年內保持公開、不下架。全文見 [LICENSE](LICENSE)。

```
城市通友善包（捷伴・找服務・輔助使用）— accessibility add-ons for the TownPass app
Copyright (C) 2026 城市通友善包 contributors (OG-Matcha, Applause0219, KevensDreamLand, YUEYUE14)

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

本專案修改自臺北市政府 [taipei-doit/TownPass](https://github.com/taipei-doit/TownPass)（GPL-3.0）。GPL-3.0 第 13 條允許與 AGPL-3.0 作品結合散布；原作者著作權標示保留。

---

# What is Town Pass?

Town Pass is an open-source project developed by the Taipei City Government. With the growth of smart cities, the demand for digitalization in city management and citizen services continues to rise. As we enter a new digital era, our goal is to involve citizens in the process, combining third-party expertise and innovation to make digital life in Taipei more convenient.

Town Pass is not just an application; it is an open community project. Through open-source, every citizen can participate in the ideation, development, and optimization of the application. This not only enhances citizen engagement and satisfaction but also leverages collective intelligence to continuously improve the application, making it truly serve the people. Furthermore, we hope that various municipalities can widely adopt the open-source framework of Town Pass, integrate it with their existing municipal service systems, and quickly have their own applications to enhance digital governance.

Open source is a key driver of technological progress and social development. Through open-source, Town Pass will become an ever-evolving platform, attracting developers from all backgrounds to contribute. We welcome experts to submit code, report issues, provide suggestions, and even develop new features and creative ideas, working together to perfect Town Pass as we advance toward a smart city.

# Getting Started

We highly recommend to read through our [document](https://tpe-guideline.web.app/en/docs/) for more detail.

Here are some quick setup guide.

## Requirement

- [Flutter](https://docs.flutter.dev/get-started/install) or [FVM](https://fvm.app/documentation/getting-started/installation)
- [XCode](https://developer.apple.com/xcode/) (for iOS)
- [Android SDK](https://developer.android.com/studio/index.html) (for Android, with or without Android Studio)

## Build the Project

1. Get the packages project needed:

   ``` bash
   flutter pub get
   ```

2. Generate additional needed dart code for the project.

   ``` bash
   dart run build_runner build
   ```

3. You are all set now, Run the project from your IDE or the through the command line:

   ``` bash
   flutter run
   ```

# 找服務：裝置端語意搜尋（隊伍新增）

操作輔助層的「找服務」可以聽懂口語（「家裡水管爆了」「想帶狗出去透透氣」），不只比對關鍵字。
**推論全程在手機上，不呼叫任何雲端模型，飛航模式可用。** 模型載入中、失敗，或不在 App 內時，自動退回原本的規則搜尋，使用者看不到錯誤。

## 裝置端 AI 揭露

| 項目 | 內容 |
|---|---|
| 模型名稱 | EmbeddingGemma 2 Text 270M（文字向量模型，不是生成式 LLM） |
| 版本 | `litert-community/embeddinggemma-2-text-270m-litert-lm`，修訂版 `9be6e8b90982095dc05c2bd162e4b954ee4dbac7` |
| 檔案 | `embeddinggemma-2-text-270m.litertlm`（164,626,432 位元組），SHA-256 `2d079ee2f6f066b1f368e8d7c819f55214eaef1d0513b312321901f30ab286fb` |
| 量化格式 | int4 per-channel（QAT，量化感知訓練），Transformer 與 Embeddings 皆是（出處：上述固定修訂版的模型卡 Quantization Scheme 欄，文字版） |
| 輸入長度 | 向量用 `sentenceSimilarity` 任務，文件與問題同一顆模型、同一種用法；模型上限 1024 tokens，問題超過 200 字不送進模型 |
| 推論框架 | `flutter_edge_ai` 2.5.5 ＋ `flutter_edge_ai_litertlm` 1.19.1（Google LiteRT-LM），CPU 推論 |
| 來源 URL | https://huggingface.co/litert-community/embeddinggemma-2-text-270m-litert-lm |
| 授權 | Apache-2.0：轉換版 repo 與基礎模型 [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2) 的 model card 都標示 `license: apache-2.0`、不需登入（2026-11-08 以 Hugging Face API 核對）。不是舊版 EmbeddingGemma 的 Gemma Terms of Use |
| 廠牌 | Google（非中國廠牌；未使用 Qwen、DeepSeek、BGE 等） |

**App 裡只有這一顆向量模型。** 捷運陪伴微服務（`assets/web/mrt/`）的語音指令與目的地語意搜尋也透過 `embed` handler（`lib/util/web_message_handler/embed_message_handler.dart`）共用同一個已載入的實例；網頁原本自帶的 multilingual-e5-small 不再打包進 App（只留給一般瀏覽器部署）。選它的量測：同一組題目上兩顆模型的比較見主工作區 `docs/research/17_向量模型二選一.md`。

**語音辨識與朗讀（手機系統元件，不打包、不連雲端）**

| 項目 | 語音辨識（用講的） | 朗讀（唸給我聽） |
|---|---|---|
| 元件 | Android `SpeechRecognizer.createOnDeviceSpeechRecognizer`：Google 裝置端辨識（SODA，Android System Intelligence 提供） | Android 系統 TTS（`flutter_tts` 4.2.5（MIT）），只選已安裝、不需網路的語音 |
| 語言包 | 中文（台灣）`cmn-Hant-TW` v3056，約 56 MB；手機沒有時由 App 呼叫 `SpeechRecognizer.triggerModelDownload`（Android 13+）叫出系統下載視窗，下載一次（需網路），之後離線可用 | 系統內建語音 |
| 呼叫方式 | `speech_to_text` 7.5.0（BSD-3-Clause），`onDevice: true`；語言標籤一律送 `cmn-Hant-TW`（`lib/util/speech/voice_input.dart`） | `lib/util/web_message_handler/tts_message_handler.dart` |
| 不會做的事 | 不退回雲端辨識；沒有語言包就請使用者打字或下載 | 沒有離線語音就回錯誤，不改用雲端語音 |

實機驗證（2026-11-08，Xiaomi 2602EPTC0G、Android 16、飛航模式）：logcat 顯示 `SodaSpeechRecognizer: Offline recognizer - start detection`，說「台北車站」辨識成功。

模型檔不進 git。取得：`bash tool/semantic_search/fetch_model.sh`（固定修訂版並驗證 SHA-256，會放到 `assets/models/`）。
打包進 App 後，第一次啟動複製到 App 私有目錄再載入，不依賴執行時下載。

## 運作方式

1. 每個服務有團隊整理的「市民會怎麼說」例句（`tool/semantic_search/phrases.json`，不是官方資料），第一次啟動時在背景轉成向量並快取（快取鍵＝服務清單與例句＋模型版本＋用法）。
2. 使用者說一句話 → 網頁送 `service_rank` 給 App → App 回每個服務的相似度 → `tp-a11y.js` 的 `mergeRanking` 與規則分數合併排序。
3. **畫面只有一份（Flutter）**：首頁右下角的「找服務」浮動鈕，以及微服務網頁輔助選單裡的「找服務」（網頁會送 `open_find_service` 請 App 開同一個頁面），都是 `lib/page/find_service/`。網頁內建的搜尋頁只在一般瀏覽器（桌面開發）或舊版 App 沒回應時當備援。
   規則搜尋與合併邏輯目前在 JS 與 Dart 各有一份，以 `tool/semantic_search/parity.json`（JS 算出的標準答案）逐題比對防止漂移；改任一邊後執行 `node tool/semantic_search/make_parity.mjs` 並讓兩邊測試通過。
4. App 的 21 個服務全部參與；沒有入口的服務（`destinationUrl` 為空）標示「還沒開通」，按鈕改為撥 1999。

## 量測（`tool/semantic_search/`）

- 題目：`queries.json`（30 題，定參數時看過）、`queries_holdout.json`（22 題，參數定案後才量）。
- 重現：`bash tool/semantic_search/run_eval.sh`（需要 arm64 Android 裝置或模擬器）；基準：`node tool/semantic_search/baseline.mjs`。
- 結果與限制見 `tool/semantic_search/semantic-result.json`；`scores.json` 是模擬器上真模型算出的原始分數。

## 第三方套件（新增）

| 套件 | 版本 | 授權 | 用途 |
|---|---|---|---|
| flutter_edge_ai | 2.5.5（寫死） | MIT | 裝置端推論主套件 |
| flutter_edge_ai_litertlm | 1.19.1（寫死） | MIT | LiteRT-LM 引擎；建置時從 GitHub releases 下載原生函式庫並驗證 SHA-256 |
| path_provider | 2.1.6（寫死） | BSD-3 | 快取檔位置（原本就是間接相依） |
| background_downloader、connectivity_plus（＋ platform_interface）、genai_primitives、json_schema_builder、mutex | 見 `pubspec.lock` | BSD-3 | `flutter_edge_ai` 的間接相依 |
| large_file_handler | 0.5.2 | MIT | 把 165 MB 模型從 asset 串流複製到私有目錄 |
| decimal、rational | 見 `pubspec.lock` | Apache-2.0 | 間接相依 |
| nm | 0.5.0 | **MPL-2.0** | 間接相依（檔案層級的 copyleft，與 AGPL-3.0 專案可並用，已標註） |

Android：`minSdk` 改為 30、ABI 限 `arm64-v8a`（LiteRT 的要求；不支援 Android 10 以下）。比賽期間不 `pub upgrade`。
