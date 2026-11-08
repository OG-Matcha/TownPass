// 路上語音意圖分類（裝置端）。向量模型兩條路，對外介面相同：
// - 城市通 App 裡：App 的 `embed` handler（EmbeddingGemma 2 Text 270M，與「找服務」共用同一顆；appEmbed.ts）
// - 一般瀏覽器：multilingual-e5-small（Microsoft, MIT）int8 ONNX，transformers.js 跑在 Web Worker（intentWorker.ts），本機 /models，不連網
// 模型沒載好／單次超過 1.5 秒／印尼文等拉丁字母輸入 → 退回小型規則（by: "rules"）。

import { initAppEmbed, appRequest } from "./appEmbed";
import { inTownPass } from "./bridge";

export type Intent = "next" | "repeat" | "help" | "bigger" | "back" | "pause" | "resume" | "end" | "none";
type Pred = Intent | "unsure";

/** 最高相似度低於此值 → "unsure"（請 UI 反問）。e5 分數整體偏高；門檻只用 scripts/intent-dev.json 選。 */
// 門檻依開發集 scripts/intent-dev.json 選：0.90 與 0.91 做錯同為 3 句，0.90 反問較少（7% 對 12%）
export const UNSURE_THRESHOLD = 0.9;
/** 在城市通 App 裡改用 App 的 EmbeddingGemma 2（appEmbed.ts）時的門檻；同樣只用 intent-dev.json 選：
 *  開發集「正確 − 4×做錯」最高的區間是 0.50–0.87，取最保守的一端（docs/research/17）。 */
export const UNSURE_THRESHOLD_APP = 0.87;
// e5 規定：範例句與查詢都要加 "query: " 前綴
const PREFIX = "query: ";
const MODEL_ID = "Xenova/multilingual-e5-small";
/** 單次分類超過此時間就這次改走規則（冷啟動、低階機） */
const REQUEST_TIMEOUT_MS = 1500;
/** worker 載入模型最長等待；超過視為這台裝置跑不動，永久走規則 */
const INIT_TIMEOUT_MS = 120_000;

// 範例句（自己寫；只用 scripts/intent-dev.json 的失敗調整過，未參考盲測集）
export const EXEMPLARS: Record<Intent, string[]> = {
  next: ["下一步", "到了", "我到了", "下車了", "換好車了", "出站了", "進站了", "好了繼續", "上車了", "接下來呢", "然後呢", "已經到站了", "我們到了", "接著要怎麼走"],
  repeat: ["再說一次", "再念一次", "剛剛說什麼", "我沒聽清楚", "現在要做什麼", "要往哪裡走", "這一步是什麼", "重複一遍", "念給我聽", "重新說一下", "麻煩再講一遍"],
  help: ["找不到電梯", "電梯在哪裡", "我迷路了", "電梯壞了", "需要人幫忙", "救命", "我不知道怎麼走", "沒有看到電梯", "幫我叫站務人員"],
  bigger: ["字太小了", "看不清楚", "放大", "字大一點", "看不到字", "按鈕太小"],
  back: ["上一步", "回上一步", "我按錯了", "退回去", "回到剛剛那一步", "不對還沒到"],
  pause: ["暫停", "先不要講", "安靜", "停一下", "不要念了", "先停止導航"],
  resume: ["繼續導航", "繼續講", "恢復", "可以繼續了", "再開始念", "你繼續說"],
  end: ["結束", "不去了", "取消導航", "結束這趟", "我不搭了", "停止行程", "到此為止", "關掉導航", "不用導航了", "不要再導了"],
  none: ["媽你等一下", "喂你好", "小心腳下", "等一下再說", "要不要喝水", "列車即將進站", "我在捷運上晚點打給你", "今天好冷", "晚上吃什麼", "前面人很多", "下一班車什麼時候來", "我餓了", "肚子好餓"],
};

// ---- 規則備援（含印尼文關鍵字）----
const RULES: [Intent, RegExp][] = [
  ["resume", /(繼續導航|繼續講|繼續說|恢復|lanjutkan|teruskan)/],
  ["end", /(結束|不去了|取消|selesai|akhiri)/],
  ["pause", /(暫停|安靜|停一下|先不要|berhenti|diam)/],
  ["back", /(上一步|上一頁|退回|按錯|kembali|mundur)/],
  ["bigger", /(放大|大一點|太小|看不清|besar)/],
  ["help", /(找不到|在哪|迷路|救命|幫忙|幫我|求助|tolong|bantu)/],
  ["repeat", /(再說|再念|再唸|重複|重說|沒聽清|念給我|唸給我|ulang|baca)/],
  ["next", /(下一步|下一個|到了|到站|換好|出站|進站|下車|上車|好了|繼續|lanjut|berikut|sudah sampai|sampai)/],
];

function classifyByRules(raw: string): { intent: Pred; score: number } {
  const t = raw.replace(/\s+/g, " ").replace(/臺/g, "台").toLowerCase();
  for (const [intent, re] of RULES) if (re.test(t)) return { intent, score: 1 };
  return { intent: "unsure", score: 0 };
}

// ---- 模型（在 worker 裡）----
type Best = Partial<Record<Intent, number>>;
type ResultMsg = { type: "result"; id: number; error?: string } & Record<string, unknown>;
type FromWorker = { type: "ready" } | { type: "error"; message: string } | ResultMsg;

let worker: Worker | null = null;
let warming: Promise<void> | null = null;
let ready = false;
/** 向量從哪裡來：worker＝網頁自己的 e5；app＝城市通 App 的 embed handler（EmbeddingGemma 2） */
let backend: "worker" | "app" = "worker";
export const embedBackend = () => backend;
/** worker／WASM 在這個 WebView 起不來 → 永久走規則 */
let dead = false;
let nextId = 1;
const pending = new Map<number, (m: ResultMsg | null) => void>();

export function intentReady(): boolean {
  return ready;
}

function kill(reason: unknown) {
  if (!dead) console.warn("[intent] model unavailable, using rules", reason);
  dead = true;
  ready = false;
  try {
    worker?.terminate();
  } catch {}
  worker = null;
  for (const r of pending.values()) r(null);
  pending.clear();
}

/** 在背景載入模型；永不 reject。失敗時 intentReady() 維持 false，classifyIntent 走規則。 */
export function warmIntent(): Promise<void> {
  if (warming) return warming;
  // 在城市通 App 裡先用 App 的向量服務（App 不再打包 e5）；舊版 App 沒有 embed handler → 照舊載入 e5 worker
  const viaApp = inTownPass() ? initAppEmbed(EXEMPLARS).catch(() => false) : Promise.resolve(false);
  warming = viaApp.then((ok) => {
    if (ok) {
      backend = "app";
      ready = true;
      return;
    }
    return startWorker();
  });
  return warming;
}

function startWorker(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (dead) return resolve();
    let initTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (e: unknown) => {
      clearTimeout(initTimer);
      kill(e);
      resolve();
    };
    try {
      if (typeof Worker === "undefined") throw new Error("Worker unsupported");
      const base = import.meta.env.BASE_URL;
      const modelPath = new URL(base + "models/", location.href).pathname.replace(/^\/?/, "/");
      const ortBase = new URL(base + "ort/", location.href).href;
      const w = new Worker(new URL("./intentWorker.ts", import.meta.url), { type: "module" });
      worker = w;
      w.onerror = (ev) => {
        ev.preventDefault?.();
        fail(ev.message || "worker error");
      };
      w.onmessageerror = () => fail("worker messageerror");
      w.onmessage = (ev: MessageEvent<FromWorker>) => {
        const m = ev.data;
        if (m.type === "ready") {
          clearTimeout(initTimer);
          ready = true;
          resolve();
        } else if (m.type === "error") {
          fail(m.message);
        } else if (m.type === "result") {
          const r = pending.get(m.id);
          if (r) {
            pending.delete(m.id);
            r(m.error ? null : m);
          }
        }
      };
      initTimer = setTimeout(() => fail("init timeout"), INIT_TIMEOUT_MS);
      w.postMessage({ type: "init", modelPath, ortBase, modelId: MODEL_ID, prefix: PREFIX, exemplars: EXEMPLARS });
    } catch (e) {
      fail(e);
    }
  });
}

/** 丟一個請求給模型 worker；超時、worker 掛掉、錯誤都回 null（呼叫端走規則）。placeSearch 的語意搜尋也用這個。 */
export function workerRequest(payload: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ResultMsg | null> {
  if (backend === "app") return ready ? (appRequest(payload, timeoutMs) as Promise<ResultMsg | null>) : Promise.resolve(null);
  const w = worker;
  if (!w || dead) return Promise.resolve(null);
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // 這次太慢 → 走規則；晚到的結果丟掉
      if (pending.delete(id)) resolve(null);
    }, timeoutMs);
    pending.set(id, (m) => {
      clearTimeout(timer);
      resolve(m);
    });
    try {
      w.postMessage({ ...payload, id });
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}
async function askWorker(text: string): Promise<Best | null> {
  const m = await workerRequest({ type: "classify", text });
  return m && m.best ? (m.best as Best) : null;
}

const HAS_LATIN_WORD = /[A-Za-z]{2,}/;

export async function classifyIntent(
  text: string,
): Promise<{ intent: Intent | "unsure"; score: number; ms: number; by: "model" | "rules" }> {
  const t0 = performance.now();
  const s = text.trim();
  if (!s) return { intent: "unsure", score: 0, ms: 0, by: "rules" };
  const rules = () => ({ ...classifyByRules(s), ms: performance.now() - t0, by: "rules" as const });
  if (!ready || dead || HAS_LATIN_WORD.test(s)) return rules();
  const best = await askWorker(s).catch(() => null);
  if (!best) return rules();
  let top: Intent = "none";
  let score = -2;
  for (const k of Object.keys(best) as Intent[]) if (best[k]! > score) ((top = k), (score = best[k]!));
  return { intent: score >= (backend === "app" ? UNSURE_THRESHOLD_APP : UNSURE_THRESHOLD) ? top : "unsure", score, ms: performance.now() - t0, by: "model" };
}
