// 在城市通 App 裡：句子向量改由 App 的 `embed` handler 算（EmbeddingGemma 2 Text 270M，Apache-2.0，
// 與 App「找服務」共用同一顆、同一個實例，裝置端 LiteRT-LM），網頁不必再帶自己的 e5 模型。
// 一般瀏覽器沒有 App → 仍用 intentWorker.ts（e5）。兩條路對外提供同一組操作（classify／index／nearest），
// 呼叫端只差在門檻（兩顆模型的分數分布不同，見 intent.ts、placeSearch.ts）。
// 協定：網頁 → App {name:'embed', data:{texts:[...], kind:'query'|'document', rid}}
//      App → 網頁 {name:'embed', data:{ok:true, rid, vectors:number[][], dim, model}} | {ok:false, rid, reason}
import { flutter } from "./bridge";

/** 一批最多幾句（App 端上限 32）；小批次讓使用者的查詢不用等太久 */
const BATCH = 8;
let seq = 1;

function embed(texts: string[], kind: "query" | "document", timeoutMs: number): Promise<Float32Array[] | null> {
  const f = flutter();
  if (!f || !texts.length) return Promise.resolve(null);
  const rid = `embed-${seq++}`;
  return new Promise((resolve) => {
    const onMessage = (e: { data: string }) => {
      try {
        const msg = JSON.parse(e.data) as { name?: string; data?: { ok?: boolean; rid?: unknown; vectors?: number[][] } };
        if (msg.name !== "embed" || msg.data?.rid !== rid) return; // 別人的回覆
        cleanup();
        const v = msg.data.vectors;
        if (!msg.data.ok || !Array.isArray(v) || v.length !== texts.length) return resolve(null);
        resolve(v.map((x) => unit(Float32Array.from(x))));
      } catch {}
    };
    const timer = setTimeout(() => (cleanup(), resolve(null)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      f.removeEventListener("message", onMessage);
    };
    f.addEventListener("message", onMessage);
    try {
      f.postMessage(JSON.stringify({ name: "embed", data: { texts, kind, rid } }));
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

function unit(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
const dot = (a: Float32Array, b: Float32Array) => {
  if (a.length !== b.length) return -2;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

async function embedAll(items: string[], kind: "query" | "document", timeoutMs: number): Promise<Float32Array[] | null> {
  const out: Float32Array[] = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const v = await embed(items.slice(i, i + BATCH), kind, timeoutMs);
    if (!v) return null;
    out.push(...v);
  }
  return out;
}

let exVecs: { intent: string; v: Float32Array }[] = [];
const indexes = new Map<string, { id: string; v: Float32Array }[]>();

/** 第一次會等 App 載入模型（冷啟動可能十幾秒），所以第一批給較長的時間。成功回 true。 */
export async function initAppEmbed(exemplars: Record<string, string[]>, timeoutMs = 60_000): Promise<boolean> {
  if (!flutter()) return false;
  const items = Object.entries(exemplars).flatMap(([k, a]) => a.map((s) => [k, s] as const));
  // 先送一句探路：舊版 App 沒有 embed handler 時不會回覆，等逾時就退回 e5／規則
  const probe = await embed([items[0][1]], "document", timeoutMs);
  if (!probe) return false;
  const rest = await embedAll(items.slice(1).map((x) => x[1]), "document", 30_000);
  if (!rest) return false;
  const vecs = [probe[0], ...rest];
  exVecs = items.map(([intent], i) => ({ intent, v: vecs[i] }));
  return true;
}

/** 與 intentWorker.ts 同樣的請求格式；失敗回 null（呼叫端走規則）。 */
export async function appRequest(payload: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown> | null> {
  if (payload.type === "classify") {
    const q = (await embed([String(payload.text)], "query", timeoutMs))?.[0];
    if (!q) return null;
    const best: Record<string, number> = {};
    for (const { intent, v } of exVecs) {
      const s = dot(v, q);
      if (s > (best[intent] ?? -2)) best[intent] = s;
    }
    return { type: "result", best };
  }
  if (payload.type === "index") {
    const items = payload.items as { id: string; text: string }[];
    const vecs = await embedAll(items.map((x) => x.text), "document", Math.max(timeoutMs / Math.ceil(items.length / BATCH), 15_000));
    if (!vecs) return null;
    indexes.set(String(payload.name), items.map((x, i) => ({ id: x.id, v: vecs[i] })));
    return { type: "result", n: items.length };
  }
  if (payload.type === "nearest") {
    const list = indexes.get(String(payload.index));
    if (!list) return null;
    const q = (await embed([String(payload.text)], "query", timeoutMs))?.[0];
    if (!q) return null;
    const best = new Map<string, number>();
    for (const { id, v } of list) {
      const s = dot(v, q);
      if (s > (best.get(id) ?? -2)) best.set(id, s);
    }
    const hits = [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, Number(payload.k) || 3);
    return { type: "result", hits };
  }
  return null;
}
