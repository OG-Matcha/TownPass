// 建置時抓「出站後最後一哩」的開放資料，存成 public/data/lastmile.json。
// 原因：data.taipei 不開 CORS，前端不能直接抓；評審可能斷網，資料要打包。
// 做法：只保留無障礙出入口（elevators.json）與目的地（places.json）300 公尺內的資料，
//       TWD97（EPSG:3826）轉 WGS84，欄位縮到最少。
// 用法：node scripts/fetch-lastmile.mjs
// 資料來源（2026-11-08 以 curl 確認可下載）：
//   1. 臺北市人行道固定設施物_無障礙斜坡道（工務局新工處，GeoJSON 點，TWD97）
//   2. 臺北市人行道固定設施物_人行道範圍圖（工務局新工處，GeoJSON 面，TWD97，含淨寬）
//   3. 臺北市 今日施工資訊（工務局，GeoJSON 點，TWD97，每 10 分更新；data.taipei 的 download 會 500，要抓 blob 原址）
//   4. 臺北市公園無障礙出入口點位（工務局公園處，CSV Big5，TWD97，含人行道寬度與坡度）
// 授權都是「政府資料開放授權條款-第 1 版」。
import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/data/", import.meta.url);
const RADIUS_M = 300;

const SOURCES = {
  ramps: {
    title: "臺北市人行道固定設施物_無障礙斜坡道",
    dataset: "https://data.taipei/dataset/detail?id=8ab0c662-b560-4310-a825-001ae7fdc524",
    url: "https://data.taipei/api/dataset/8ab0c662-b560-4310-a825-001ae7fdc524/resource/ee522d94-daa7-4118-b52a-4bf144af2744/download",
  },
  sidewalks: {
    title: "臺北市人行道固定設施物_人行道範圍圖",
    dataset: "https://data.taipei/dataset/detail?id=715d3a83-8445-4496-b6bf-b0900538b7e7",
    url: "https://data.taipei/api/dataset/715d3a83-8445-4496-b6bf-b0900538b7e7/resource/b11d6142-1d71-41d5-a843-7b7cfcea61ef/download",
  },
  works: {
    title: "臺北市 今日施工資訊",
    dataset: "https://data.taipei/dataset/detail?id=c208dabd-2da0-4e6d-8dbd-a004b9782b0a",
    url: "https://tpnco.blob.core.windows.net/blobfs/Todaywork.json",
  },
  parkEntrances: {
    title: "臺北市公園無障礙出入口點位",
    dataset: "https://data.taipei/dataset/detail?id=5a7258c2-5ded-4149-8664-ae10903fe372",
    url: "https://data.taipei/api/dataset/5a7258c2-5ded-4149-8664-ae10903fe372/resource/70defec1-fd51-471b-89fa-5c7636150e6a/download",
  },
};

// data.taipei 連線偶爾中斷：每個請求最多試 4 次
async function get(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw last;
}

// TWD97 二度分帶（EPSG:3826）→ WGS84。GRS80 橢球、中央經線 121°E、k0 = 0.9999、東偏 250000。
// TWD97 與 WGS84 在台灣差不到 1 公尺，這裡直接當同一個基準。
export function twd97ToWgs84(x, y) {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9999;
  const lon0 = (121 * Math.PI) / 180;
  const dx = 250000;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const xx = x - dx;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const T1 = tan1 * tan1;
  const C1 = ep2 * cos1 * cos1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = xx / (N1 * k0);
  const lat =
    phi1 -
    ((N1 * tan1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos1;
  return { lat: (lat * 180) / Math.PI, lng: (lon * 180) / Math.PI };
}

// 公尺距離（haversine），300 公尺內的誤差可忽略
export function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const r2 = (n) => Math.round(n * 100) / 100;

// 錨點：捷運無障礙出入口（電梯、坡道）與目的地；只保留它們 300 公尺內的資料
async function loadAnchors() {
  const el = JSON.parse(await readFile(new URL("elevators.json", OUT), "utf8"));
  const pl = JSON.parse(await readFile(new URL("places.json", OUT), "utf8"));
  const anchors = [
    ...el.items.map((i) => ({ lat: i.lat, lng: i.lng, id: `${i.station}/${i.exit}` })),
    ...pl.map((p) => ({ lat: p.lat, lng: p.lng, id: p.id })),
  ].filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng));
  // 粗篩用的格子（約 0.003 度 ≈ 300 公尺）
  const cell = 0.003;
  const grid = new Map();
  for (const a of anchors) {
    const k = `${Math.floor(a.lat / cell)},${Math.floor(a.lng / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)).push(a);
  }
  const near = (p) => {
    const gy = Math.floor(p.lat / cell);
    const gx = Math.floor(p.lng / cell);
    let best = null;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const a of grid.get(`${gy + dy},${gx + dx}`) ?? []) {
          const d = distM(p, a);
          if (d <= RADIUS_M && (!best || d < best.d)) best = { d, a };
        }
    return best;
  };
  return { anchors, near };
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  const [head, ...body] = rows;
  return body.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function fetchRamps(near) {
  const res = await get(SOURCES.ramps.url);
  const gj = JSON.parse((await res.text()).replace(/^﻿/, ""));
  const out = [];
  for (const f of gj.features) {
    if (f.geometry?.type !== "Point") continue;
    const [x, y] = f.geometry.coordinates;
    const p = twd97ToWgs84(x, y);
    if (!near(p)) continue;
    // Name：無障礙斜坡道（路緣斜坡）或 汽車斜坡道（車輛出入口，對輪椅沒幫助，但會有坡）
    out.push({ lat: r6(p.lat), lng: r6(p.lng), kind: f.properties.Name === "汽車斜坡道" ? "car" : "curb" });
  }
  return { total: gj.features.length, items: out };
}

async function fetchSidewalks(near) {
  const res = await get(SOURCES.sidewalks.url);
  const gj = JSON.parse((await res.text()).replace(/^﻿/, ""));
  const out = [];
  for (const f of gj.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
    // 面的代表點：所有外環頂點的平均；另外記最近錨點，給前端直接查
    let sx = 0, sy = 0, n = 0;
    for (const poly of polys) for (const [x, y] of poly[0] ?? []) { sx += x; sy += y; n++; }
    if (!n) continue;
    const c = twd97ToWgs84(sx / n, sy / n);
    const hit = near(c);
    if (!hit) continue;
    const p = f.properties;
    out.push({
      lat: r6(c.lat),
      lng: r6(c.lng),
      road: p.NAME_Road ?? "",
      from: p.PSTART ?? "",
      to: p.PEND ?? "",
      side: p.SW_DIRECT ?? "",
      width: r2(Number(p.SW_WTH_ItemValue) || 0),
      netWidth: r2(Number(p.SWW_WTH) || 0),
      length: Math.round(Number(p.SW_LENG_ItemValue) || 0),
      type: p.code ?? "",
    });
  }
  return { total: gj.features.length, items: out };
}

async function fetchWorks(near) {
  const res = await get(SOURCES.works.url);
  const gj = JSON.parse((await res.text()).replace(/^﻿/, ""));
  const out = [];
  for (const f of gj.features) {
    if (f.geometry?.type !== "Point") continue;
    const [x, y] = f.geometry.coordinates;
    const p = twd97ToWgs84(x, y);
    if (!near(p)) continue;
    const q = f.properties;
    out.push({
      lat: r6(p.lat),
      lng: r6(p.lng),
      addr: q.Addr ?? "",
      org: q.App_Name ?? "",
      purpose: q.NPurp ?? "",
      from: q.Cb_Da ?? "",
      until: q.Ce_Da ?? "",
      time: q.Co_Ti ?? "",
      blocks: q.IsBlock === "是",
      planB: q.PlanB ?? "",
    });
  }
  return { total: gj.features.length, items: out };
}

async function fetchParkEntrances(near) {
  const res = await get(SOURCES.parkEntrances.url);
  const text = new TextDecoder("big5").decode(await res.arrayBuffer());
  const rows = parseCsv(text);
  const out = [];
  for (const r of rows) {
    const p = twd97ToWgs84(Number(r["TW97座標X"]), Number(r["TW97座標Y"]));
    if (!Number.isFinite(p.lat) || !near(p)) continue;
    out.push({
      lat: r6(p.lat),
      lng: r6(p.lng),
      park: r["公園名稱"] ?? "",
      name: r["無障礙出入口名稱"] ?? "",
      width: Number(r["人行道寬度"]) || null,
      slope: Number(r["坡度"]) || 0,
    });
  }
  return { total: rows.length, items: out };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const { anchors, near } = await loadAnchors();
  const [ramps, sidewalks, works, parkEntrances] = await Promise.all([
    fetchRamps(near),
    fetchSidewalks(near),
    fetchWorks(near),
    fetchParkEntrances(near),
  ]);
  const data = {
    sources: Object.fromEntries(Object.entries(SOURCES).map(([k, v]) => [k, { title: v.title, dataset: v.dataset }])),
    license: "政府資料開放授權條款-第1版",
    fetchedAt: new Date().toISOString(),
    radiusM: RADIUS_M,
    anchors: anchors.length,
    ramps: ramps.items,
    sidewalks: sidewalks.items,
    works: works.items,
    parkEntrances: parkEntrances.items,
  };
  const json = JSON.stringify(data);
  await writeFile(new URL("lastmile.json", OUT), json);
  console.log(`anchors ${anchors.length}（半徑 ${RADIUS_M} m）`);
  console.log(`ramps ${ramps.items.length}/${ramps.total}`);
  console.log(`sidewalks ${sidewalks.items.length}/${sidewalks.total}`);
  console.log(`works ${works.items.length}/${works.total}（擋通行 ${works.items.filter((w) => w.blocks).length}）`);
  console.log(`parkEntrances ${parkEntrances.items.length}/${parkEntrances.total}`);
  console.log(`lastmile.json ${(json.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
