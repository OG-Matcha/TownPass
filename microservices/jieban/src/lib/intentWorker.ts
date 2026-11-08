// 意圖模型 Web Worker：multilingual-e5-small int8 ONNX（transformers.js），所有模型工作都在這裡，主執行緒不卡。
// 協定：
//   主 → worker  {type:"init", modelPath, ortBase, modelId, prefix, exemplars}
//   worker → 主  {type:"ready"} | {type:"error", message}
//   主 → worker  {type:"classify", id, text}
//   worker → 主  {type:"result", id, best: Record<intent, number>} | {type:"result", id, error}
//   主 → worker  {type:"index", id, name, items:[{id,text}]}      （目的地語意搜尋：把地點／分類句向量化存起來）
//   worker → 主  {type:"result", id, n}
//   主 → worker  {type:"nearest", id, index, text, k}
//   worker → 主  {type:"result", id, hits:[{id, score}]}
import { env, pipeline } from "@huggingface/transformers";

type Extractor = (t: string | string[], o: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
type InitMsg = { type: "init"; modelPath: string; ortBase: string; modelId: string; prefix: string; exemplars: Record<string, string[]> };
type ClassifyMsg = { type: "classify"; id: number; text: string };
type IndexMsg = { type: "index"; id: number; name: string; items: { id: string; text: string }[] };
type NearestMsg = { type: "nearest"; id: number; index: string; text: string; k: number };

let extractor: Extractor | null = null;
let exVecs: { intent: string; v: Float32Array }[] = [];
const indexes = new Map<string, { id: string; v: Float32Array }[]>();
let prefix = "query: ";
let initP: Promise<void> | null = null;
const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

async function init(m: InitMsg): Promise<void> {
  prefix = m.prefix;
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = m.modelPath;
  env.useBrowserCache = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = { mjs: m.ortBase + "ort-wasm-simd-threaded.mjs", wasm: m.ortBase + "ort-wasm-simd-threaded.wasm" };
    wasm.numThreads = 1; // WebView 多半沒有 cross-origin isolation，單執行緒最穩
    wasm.proxy = false; // 已經在 worker 裡
  }
  const ex = (await pipeline("feature-extraction", m.modelId, { dtype: "q8", device: "wasm" })) as unknown as Extractor;
  const items = Object.entries(m.exemplars).flatMap(([k, a]) => a.map((s) => [k, s] as const));
  const out = await ex(items.map((x) => prefix + x[1]), { pooling: "mean", normalize: true });
  const d = out.dims[1];
  exVecs = items.map(([intent], i) => ({ intent, v: out.data.slice(i * d, (i + 1) * d) }));
  extractor = ex;
}

async function classify(text: string): Promise<Record<string, number>> {
  if (initP) await initP;
  if (!extractor) throw new Error("not ready");
  const q = (await extractor(prefix + text, { pooling: "mean", normalize: true })).data;
  const best: Record<string, number> = {};
  for (const { intent, v } of exVecs) {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * q[i];
    if (dot > (best[intent] ?? -2)) best[intent] = dot;
  }
  return best;
}

// 分批向量化（每批 16 句），中間讓 classify 請求插隊
async function index(m: IndexMsg): Promise<number> {
  if (initP) await initP;
  if (!extractor) throw new Error("not ready");
  const vecs: { id: string; v: Float32Array }[] = [];
  for (let i = 0; i < m.items.length; i += 16) {
    const batch = m.items.slice(i, i + 16);
    const out = await extractor(batch.map((x) => prefix + x.text), { pooling: "mean", normalize: true });
    const d = out.dims[1];
    batch.forEach((x, j) => vecs.push({ id: x.id, v: out.data.slice(j * d, (j + 1) * d) }));
    await new Promise((r) => setTimeout(r, 0));
  }
  indexes.set(m.name, vecs);
  return vecs.length;
}

async function nearest(m: NearestMsg): Promise<{ id: string; score: number }[]> {
  if (initP) await initP;
  if (!extractor) throw new Error("not ready");
  const list = indexes.get(m.index);
  if (!list) throw new Error("no index " + m.index);
  const q = (await extractor(prefix + m.text, { pooling: "mean", normalize: true })).data;
  const best = new Map<string, number>();
  for (const { id, v } of list) {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * q[i];
    if (dot > (best.get(id) ?? -2)) best.set(id, dot);
  }
  return [...best.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score).slice(0, m.k);
}

self.onmessage = async (e: MessageEvent<InitMsg | ClassifyMsg | IndexMsg | NearestMsg>) => {
  const m = e.data;
  if (m.type === "init") {
    if (!initP) initP = init(m);
    try {
      await initP;
      post({ type: "ready" });
    } catch (err) {
      post({ type: "error", message: String((err as Error)?.message ?? err) });
    }
  } else if (m.type === "classify") {
    try {
      post({ type: "result", id: m.id, best: await classify(m.text) });
    } catch (err) {
      post({ type: "result", id: m.id, error: String((err as Error)?.message ?? err) });
    }
  } else if (m.type === "index") {
    try {
      post({ type: "result", id: m.id, n: await index(m) });
    } catch (err) {
      post({ type: "result", id: m.id, error: String((err as Error)?.message ?? err) });
    }
  } else if (m.type === "nearest") {
    try {
      post({ type: "result", id: m.id, hits: await nearest(m) });
    } catch (err) {
      post({ type: "result", id: m.id, error: String((err as Error)?.message ?? err) });
    }
  }
};
