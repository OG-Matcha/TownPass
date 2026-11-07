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
