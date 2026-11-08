// 語音輸入：在城市通 App 裡請原生端用「裝置端」語音辨識（Flutter handler `speech_to_text`，見 team-repo）；
// 一般瀏覽器只在開發時用 Web Speech API（Chrome 會送雲端辨識，Demo 不要用這條路）。

type FlutterObject = {
  postMessage(msg: string): void;
  addEventListener(type: "message", cb: (e: { data: string }) => void): void;
  removeEventListener(type: "message", cb: (e: { data: string }) => void): void;
};

const HANDLER = "speech_to_text";
const TIMEOUT_MS = 20_000;

function flutter(): FlutterObject | null {
  return (window as unknown as { flutterObject?: FlutterObject }).flutterObject ?? null;
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
function webRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const devVoice = () => new URLSearchParams(location.search).has("devvoice");

export type VoiceSource = "app" | "browser-dev" | "none";
export function voiceSource(): VoiceSource {
  if (flutter()) return "app";
  // 一般瀏覽器的 Web Speech API 會把音訊送到 Google：預設關閉，只有網址帶 ?devvoice 才開（開發用）
  if (devVoice() && webRecognition()) return "browser-dev";
  return "none";
}

/** 聽一句話，回傳辨識文字。失敗丟出中文錯誤訊息。 */
export function listenOnce(locale = "zh-TW", timeoutMs = TIMEOUT_MS): Promise<string> {
  const f = flutter();
  if (f) {
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        clearTimeout(timer);
        f.removeEventListener("message", onMsg);
        fn();
      };
      const onMsg = (e: { data: string }) => {
        let msg: { name?: string; data?: { text?: string; error?: string; code?: string } };
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.name !== HANDLER) return;
        const d = msg.data ?? {};
        if (d.text) done(() => resolve(d.text!));
        else if (d.code === "needs_pack") {
          // 手機沒有中文離線語音：請 App 叫出系統的下載視窗（只要一次，需要網路），不改用雲端
          f.postMessage(JSON.stringify({ name: "speech_pack", data: { action: "download", locale } }));
          done(() => reject(new Error("手機還沒有中文離線語音，已開啟下載（需要網路）。下載好再按一次")));
        }
        else done(() => reject(new Error(d.error ?? "沒有聽到聲音，請再說一次")));
      };
      const timer = setTimeout(() => done(() => reject(new Error("沒有聽到聲音，請再說一次"))), timeoutMs);
      f.addEventListener("message", onMsg);
      f.postMessage(JSON.stringify({ name: HANDLER, data: { locale } }));
    });
  }
  const R = devVoice() ? webRecognition() : null;
  if (!R) return Promise.reject(new Error("這台裝置不支援語音輸入，可以用打字的"));
  return new Promise((resolve, reject) => {
    const r = new R();
    r.lang = locale;
    r.interimResults = false;
    r.maxAlternatives = 1;
    let got = false;
    r.onresult = (e) => {
      got = true;
      resolve(e.results[0][0].transcript);
    };
    r.onerror = (e) => reject(new Error(e.error === "not-allowed" ? "請允許使用麥克風" : "沒有聽清楚，請再說一次"));
    r.onend = () => {
      if (!got) reject(new Error("沒有聽到聲音，請再說一次"));
    };
    r.start();
  });
}
