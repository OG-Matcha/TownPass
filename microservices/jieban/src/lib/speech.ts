// 朗讀：點了才念（不用懸停），語速 0.85 倍（城市通無障礙規範）。
// 城市通 App 的 WebView（Android）沒有 speechSynthesis → 交給 App 原生 TTS（handler `tts`，在裝置端合成）；
// 一般瀏覽器用 Web Speech API。
export const SPEECH_RATE = 0.85;

import { showSnack } from "./snackbar.ts";

type FlutterObject = {
  postMessage(msg: string): void;
  addEventListener?(type: "message", cb: (e: { data: string }) => void): void;
};
const flutter = () => (window as unknown as { flutterObject?: FlutterObject }).flutterObject ?? null;

// App 的 tts 回 {error}（例如沒裝中文語音）時，提醒一次，不要默默失敗
let errListening = false;
let errShown = false;
function watchTtsError(f: FlutterObject) {
  if (errListening || !f.addEventListener) return;
  errListening = true;
  f.addEventListener("message", (e) => {
    if (errShown) return;
    try {
      const m = JSON.parse(e.data) as { name?: string; data?: { error?: string } };
      if (m.name !== "tts" || !m.data?.error) return;
      errShown = true;
      showSnack("這支手機沒有可用的中文語音，請到系統設定下載文字轉語音的中文語音");
    } catch {}
  });
}

export function canSpeak(): boolean {
  return !!flutter() || "speechSynthesis" in window;
}

export function speakText(text: string, locale = "zh-TW") {
  const f = flutter();
  if (f) {
    watchTtsError(f);
    f.postMessage(JSON.stringify({ name: "tts", data: { text, rate: SPEECH_RATE, locale } }));
    return;
  }
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = locale;
  u.rate = SPEECH_RATE;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

/** 念完才 resolve（念完要自動開麥克風聽時用）。
 * 瀏覽器用 onend；App 的 tts handler 只回「開始念」，所以用字數估計念完的時間。 */
export function speakAndWait(text: string, locale = "zh-TW"): Promise<void> {
  const f = flutter();
  const estimate = 600 + text.length * (locale.startsWith("zh") ? 260 : 75) / SPEECH_RATE;
  if (f || !("speechSynthesis" in window)) {
    speakText(text, locale);
    return new Promise((r) => setTimeout(r, f ? estimate : 0));
  }
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = locale;
    u.rate = SPEECH_RATE;
    const done = () => (clearTimeout(guard), resolve());
    const guard = setTimeout(done, estimate + 2000); // onend 不保證會觸發
    u.onend = done;
    u.onerror = done;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });
}

/** 停止朗讀（說「安靜」「暫停」時）。App 端：空字串 = 停止。 */
export function stopSpeaking() {
  const f = flutter();
  if (f) f.postMessage(JSON.stringify({ name: "tts", data: { text: "" } }));
  else if ("speechSynthesis" in window) speechSynthesis.cancel();
}
