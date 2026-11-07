# 操作輔助層（暫名「隨手用」）

城市通 App 在**每一個微服務網頁**注入一段 JS，微服務不用改程式就有：

| 代號 | 功能 | 說明 |
|---|---|---|
| F1 | 按偏偵測 | 點空白但 24px 內有按鈕、或同一顆 600ms 內連點，30 秒內 3 次 → 先問「要不要放大」 |
| F2 | 字級三段＋高對比 | 整頁縮放 100／125／150%（字和按鈕一起變大）；高對比把對比不足 7:1 的字自動加深 |
| F3 | 念這頁 | 按了才念、再按停止，語速 0.85；App 內交給裝置端 TTS |
| F4 | 單手浮動操作列 | 右下角距底 104px，可換到左手邊；所有觸控目標 64px |
| F5 | 用講的 | 「返回」「往下」「放大」「念這頁」或直接說按鈕上的字；也可以打字 |
| F6（部分） | 危險操作確認 | 用講的觸發「刪除、付款、送出」等按鈕前先確認 |

## 檔案

| 路徑 | 內容 |
|---|---|
| `assets/a11y/tp-a11y.js` | 操作輔助層本體（單一檔、零相依、Shadow DOM 隔離） |
| `lib/util/a11y/a11y_layer.dart` | 讀檔、讀寫設定（SharedPreferences）、產生 `UserScript` |
| `lib/util/web_message_handler/a11y_settings_message_handler.dart` | 網頁讀寫設定的 handler `a11y_settings` |
| `lib/util/tp_web_view.dart` | `initialUserScripts: A11yLayer.userScripts()` |
| `lib/page/setting/setting_view.dart` | 設定頁「操作輔助」開關（關掉 = 完全不注入） |
| `tool/a11y/` | 開發與檢查工具（不打包進 App） |

## 在桌面 Chrome 開發（不用編 App）

```bash
cd tool/a11y
npm ci
node serve.mjs            # 開 http://localhost:8787/demo/service.html
node unit.mjs             # 單元：指令解析、按偏判斷、對比計算（42 項）
node check.mjs            # 整合：axe、按偏流程、用講的、App 橋接模擬（44 項）
```

`demo/service.html` 是**測試用模擬頁**（仿一般微服務的小按鈕、淺灰字），資料都是模擬。
任何網頁加一行 `<script src="tp-a11y.js"></script>` 就能試。

## 微服務怎麼配合

已經自己做好某些項目的微服務可以宣告，操作輔助層就不重複處理：

```html
<meta name="tp-a11y" content="own:font,own:misstap">
```

`off`（整頁不載入）、`own:font`、`own:contrast`、`own:misstap`。設定改變時會廣播：

```js
window.addEventListener("tp-a11y:settings", (e) => e.detail); // { enabled, fontLevel, highContrast, hand }
window.__tpA11y.speak("文字"); window.__tpA11y.stop(); window.__tpA11y.listen();
```

## App 端依賴

- 朗讀用 handler `tts`、用講的用 `speech_to_text`（`onDevice: true`），在 `feat/speech-to-text-handler` 分支。
  沒有這兩個 handler 時，朗讀會顯示「這個版本的城市通還不能朗讀」，不會壞掉。
- 設定存在 App（SharedPreferences `a11y_settings`），因為網頁的 localStorage 每個網域各一份，跨微服務不會共用。

## 揭露

- **模型：無**。用講的是規則解析，不用任何 AI 模型；語音辨識在 App 內只用裝置端。
- 一般瀏覽器的 `webkitSpeechRecognition` 會把聲音送雲端辨識，所以只在 `localhost` 開發時開放。
- 圖示為自繪 SVG；動畫用瀏覽器內建 Web Animations API，並遵守「減少動態」設定。
- 開發工具：`playwright` 1.65.0（Apache-2.0）、`@axe-core/playwright` 4.14.0（MPL-2.0），只在 `tool/a11y` 開發時用，不進 App。
- 授權：AGPL-3.0（同作品）。

## 待辦

- [ ] **「輔助」鈕壓到頁面右下角的元件**（2026-11-07 模擬器實測）：字級特大時，「臨櫃叫號」最後一張卡片右側的「›」被浮動鈕蓋住一部分。整張卡仍可點，不影響操作。可考慮：捲動中把浮動鈕縮小或半透明、或依頁面底部元件位置自動避開。
- [x] **朗讀可能用到雲端語音**（2026-11-07 模擬器實測）：沒有離線中文語音時，Google 語音引擎會改用雲端合成（`cmn-tw-x-ctc-server`），違反「執行時推論在裝置端」，飛航模式也會念不出來；而且 `tts` handler 開始念之前就回報成功，失敗時使用者不知道。已轉告負責 `tts_message_handler.dart` 的隊友，隊友同意處理（只選離線語音、找不到就回錯誤）；Demo 手機要先下載離線中文語音並在飛航模式實測。
