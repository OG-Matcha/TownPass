// 斷網底圖：預先下載國土測繪中心 EMAP 圖磚，打包進 public/tiles/（評審可能關網路）。
// 範圍：z10–14 臺北捷運全線範圍；z15 每個無障礙出入口 1 公里內；z16 出入口 400 公尺內。
// 更細的縮放由 src/map/offlineTiles.ts 放大最近的上層圖磚。
// 用法：node scripts/fetch-tiles.mjs [--dry]（已下載的會跳過；每次最多 4 個連線，對圖資伺服器客氣一點）
import { mkdir, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";

const DRY = process.argv.includes("--dry");
const OUT = new URL("../public/tiles/", import.meta.url);
const SRC = (z, x, y) => `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/${z}/${y}/${x}`;
const points = JSON.parse(readFileSync(new URL("../public/data/elevators.json", import.meta.url), "utf8")).items;

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
const tiles = new Set();
const addBox = (z, w, s, e, n) => {
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) for (let y = lat2y(n, z); y <= lat2y(s, z); y++) tiles.add(`${z}/${x}/${y}`);
};
// 捷運全線外框（含一點邊界）
const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
const [S, N, W, E] = [Math.min(...lats) - 0.02, Math.max(...lats) + 0.02, Math.min(...lngs) - 0.02, Math.max(...lngs) + 0.02];
for (let z = 10; z <= 14; z++) addBox(z, W, S, E, N);
const around = (z, meters) => {
  for (const p of points) {
    const dLat = meters / 111320, dLng = meters / (111320 * Math.cos((p.lat * Math.PI) / 180));
    addBox(z, p.lng - dLng, p.lat - dLat, p.lng + dLng, p.lat + dLat);
  }
};
around(15, 1000);
around(16, 400);

const list = [...tiles].sort();
console.log(`共 ${list.length} 張圖磚（${points.length} 個出入口）`);
if (DRY) process.exit(0);

const have = [];
let done = 0, skipped = 0, failed = 0, bytes = 0;
async function one(key) {
  const [z, x, y] = key.split("/").map(Number);
  const file = new URL(`${z}/${x}/${y}.jpg`, OUT);
  try {
    await access(file);
    skipped++;
    have.push(key);
    return;
  } catch {}
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(SRC(z, x, y));
      if (!r.ok) throw new Error(r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      await mkdir(new URL(`${z}/${x}/`, OUT), { recursive: true });
      await writeFile(file, buf);
      bytes += buf.length;
      done++;
      have.push(key);
      return;
    } catch {
      await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
  failed++;
  console.log(`✗ ${key}`);
}
const queue = [...list];
await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await one(queue.shift()); }));
// 清單：網頁用來判斷本機有沒有這張（Vite 對不存在的檔案可能回 index.html）
await writeFile(new URL("index.json", OUT), JSON.stringify(have.sort()));
console.log(`下載 ${done}（${(bytes / 1e6).toFixed(1)} MB）、已存在 ${skipped}、失敗 ${failed}`);
process.exit(failed ? 1 : 0);
