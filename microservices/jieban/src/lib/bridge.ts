// 城市通 App 橋接：網頁 → App `flutterObject.postMessage(JSON.stringify({ name, data }))`，App 以同名訊息回覆。
// 一般瀏覽器沒有 flutterObject → 改用網頁標準 API，讓桌機也能開發。

type FlutterObject = {
  postMessage(msg: string): void;
  addEventListener(type: "message", cb: (e: { data: string }) => void): void;
  removeEventListener(type: "message", cb: (e: { data: string }) => void): void;
};

export function flutter(): FlutterObject | null {
  return (window as unknown as { flutterObject?: FlutterObject }).flutterObject ?? null;
}
export const inTownPass = () => !!flutter();

/** 送出並等 App 回覆同名訊息；逾時回傳 null。 */
export function askApp<T>(name: string, data: unknown = null, timeoutMs = 10_000): Promise<T | null> {
  const f = flutter();
  if (!f) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onMessage = (e: { data: string }) => {
      try {
        const msg = JSON.parse(e.data) as { name: string; data: T };
        if (msg.name !== name) return;
        cleanup();
        resolve(msg.data);
      } catch {}
    };
    const timer = setTimeout(() => (cleanup(), resolve(null)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      f.removeEventListener("message", onMessage);
    };
    f.addEventListener("message", onMessage);
    f.postMessage(JSON.stringify({ name, data }));
  });
}

/** 撥電話：App 內走 `phone_call`（WebView 不會處理 tel: 連結）。 */
export function callPhone(tel: string) {
  const f = flutter();
  if (f) f.postMessage(JSON.stringify({ name: "phone_call", data: tel }));
  else location.href = `tel:${tel}`;
}

/** 用外部 App 開連結（LINE、簡訊、官方網站）：App 內走 `launch_map`（它其實是通用的 launchUrl）。 */
export function openExternal(url: string) {
  // 只開 http(s) 與分享用的 sms:；資料裡的其他協定（例如 javascript:）一律不開
  let protocol = "";
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (!["http:", "https:", "sms:"].includes(protocol)) return;
  const f = flutter();
  if (f) f.postMessage(JSON.stringify({ name: "launch_map", data: url }));
  else window.open(url, "_blank", "noopener");
}

/** 目前位置：App 內走 `location`（原生定位權限），瀏覽器用 Geolocation。失敗回傳 null。 */
export async function currentPosition(): Promise<{ lat: number; lng: number } | null> {
  if (flutter()) {
    const p = await askApp<{ latitude?: number; longitude?: number } | []>("location", null, 15_000);
    return p && !Array.isArray(p) && p.latitude != null && p.longitude != null ? { lat: p.latitude, lng: p.longitude } : null;
  }
  if (!navigator.geolocation) return null;
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    ),
  );
}
