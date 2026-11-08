// 斷網底圖：圖磚來源 `tptile://{z}/{x}/{y}`，依序試
//   1. 打包在網頁裡的圖磚（public/tiles，由 scripts/fetch-tiles.mjs 預先下載）
//   2. 國土測繪中心線上 WMTS（有網路時）
//   3. 本機最近的上層圖磚放大裁切（斷網又縮得很近時，地圖不會變空白）
import { addProtocol } from "maplibre-gl";

export const OFFLINE_PROTOCOL = "tptile";
const BASE = `${import.meta.env.BASE_URL}tiles/`;
const MIN_LOCAL_Z = 10;
const MAX_UPSCALE = 6; // 最多放大 2^6 倍，再大就只是色塊
const online = (layer: string, z: number, x: number, y: number) =>
  `https://wmts.nlsc.gov.tw/wmts/${layer}/default/GoogleMapsCompatible/${z}/${y}/${x}`;

let index: Promise<Set<string>> | null = null;
const loadIndex = () =>
  (index ??= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((a: string[]) => new Set(a))
    .catch(() => new Set<string>()));

async function local(key: string, signal: AbortSignal) {
  const r = await fetch(`${BASE}${key}.jpg`, { signal });
  if (!r.ok) throw new Error(`本機圖磚 ${key} ${r.status}`);
  return r.arrayBuffer();
}

// 從上層圖磚裁出對應的一塊，放大成 256×256
async function upscale(key: string, dz: number, x: number, y: number, signal: AbortSignal) {
  const n = 2 ** dz;
  const s = 256 / n;
  const bmp = await createImageBitmap(new Blob([await local(key, signal)]), (x % n) * s, (y % n) * s, s, s, {
    resizeWidth: 256,
    resizeHeight: 256,
    resizeQuality: "high",
  });
  const canvas = new OffscreenCanvas(256, 256);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 })).arrayBuffer();
}

let registered = false;
export function registerOfflineTiles(layer = "EMAP") {
  if (registered) return;
  registered = true;
  addProtocol(OFFLINE_PROTOCOL, async (params, abort) => {
    const [z, x, y] = params.url.slice(`${OFFLINE_PROTOCOL}://`.length).split("/").map(Number);
    const signal = abort.signal;
    const have = await loadIndex();
    const key = `${z}/${x}/${y}`;
    if (have.has(key)) return { data: await local(key, signal) };
    if (navigator.onLine !== false) {
      try {
        const r = await fetch(online(layer, z, x, y), { signal });
        if (r.ok) return { data: await r.arrayBuffer() };
      } catch (e) {
        if (signal.aborted) throw e;
      }
    }
    for (let dz = 1; dz <= MAX_UPSCALE && z - dz >= MIN_LOCAL_Z; dz++) {
      const up = `${z - dz}/${x >> dz}/${y >> dz}`;
      if (have.has(up)) return { data: await upscale(up, dz, x, y, signal) };
    }
    throw new Error(`沒有圖磚 ${key}`);
  });
}
