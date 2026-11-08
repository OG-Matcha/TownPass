// 建置時抓 data.taipei 資料存成 public/data/*.json。
// 原因：data.taipei 不開 CORS，前端不能直接抓；而且評審可能斷網，資料要打包。
// 用法：node scripts/fetch-data.mjs
import { writeFile, mkdir } from "node:fs/promises";

const OUT = new URL("../public/data/", import.meta.url);

const SOURCES = {
  elevators: {
    // 臺北捷運車站出入口無障礙電梯、無障礙坡道GPS座標（CSV, Big5）
    dataset: "https://data.taipei/dataset/detail?id=0a3bb422-9eb5-459b-a9d4-138456516183",
    url: "https://data.taipei/api/dataset/0a3bb422-9eb5-459b-a9d4-138456516183/resource/61792c82-6609-41b2-9775-3a346934826d/download",
  },
  facilities: {
    // 臺北捷運車站無障礙設施（CSV, Big5）：輪椅停靠車廂、開門側、無障礙閘門、廁所、電梯動線
    dataset: "https://data.taipei/dataset/detail?id=3c799405-4e44-40dd-b747-daed09e88cdb",
    url: "https://data.taipei/api/dataset/3c799405-4e44-40dd-b747-daed09e88cdb/resource/5d45ef49-d60d-4354-b634-8dcf7d28da07/download",
  },
  anomalies: {
    // 臺北捷運車站無障礙設施異常公告（JSON API）
    dataset: "https://data.taipei/dataset/detail?id=d884a9c6-f86c-4854-8da7-e6516ddbe612",
    url: "https://data.taipei/api/v1/dataset/649c44eb-60b5-4746-a353-cbdc6651fc09?scope=resourceAquire&limit=1000",
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

// 各資料集站名寫法不同：「捷運淡水站」「BR01(動物園站)」「幸褔站」→ 統一成「淡水站」
export function normStation(raw) {
  let s = String(raw ?? "").trim();
  const m = s.match(/\(([^)]+)\)/);
  if (m) s = m[1];
  return s.replace(/^捷運/, "").replace(/褔/g, "福");
}

// 官方資料偶有漏小數點（例：圓山站坡道2 緯度 250717908）→ 依台灣座標位數補回
function fixCoord(v, intDigits) {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) < 1000) return n;
  const digits = String(Math.trunc(Math.abs(n)));
  return Number(`${digits.slice(0, intDigits)}.${digits.slice(intDigits)}`);
}

function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(",").map((c) => c.trim()));
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

async function fetchElevators() {
  const res = await get(SOURCES.elevators.url);
  if (!res.ok) throw new Error(`elevators HTTP ${res.status}`);
  const text = new TextDecoder("big5").decode(await res.arrayBuffer());
  const rows = parseCsv(text);
  const items = rows
    .map((r) => {
      const name = r["出入口電梯/無障礙坡道名稱"] ?? "";
      return {
        name,
        exit: r["出入口編號"] ?? "",
        lng: fixCoord(r["經度"], 3),
        lat: fixCoord(r["緯度"], 2),
        kind: name.includes("坡道") ? "ramp" : "elevator",
        // 名稱格式多為「XX站出入口電梯」→ 取站名
        station: normStation((name.match(/^(.+?站)/) ?? [])[1] ?? name),
      };
    })
    // 只留臺北捷運範圍內的點，其他丟掉並印出來
    .filter((x) => {
      const ok = x.lat > 24.8 && x.lat < 25.4 && x.lng > 121.2 && x.lng < 121.9;
      if (!ok) console.warn("drop out-of-range:", x.name, x.lng, x.lat);
      return ok;
    });
  return { source: SOURCES.elevators.dataset, fetchedAt: new Date().toISOString(), items };
}

async function fetchAnomalies() {
  const res = await get(SOURCES.anomalies.url);
  if (!res.ok) throw new Error(`anomalies HTTP ${res.status}`);
  const json = await res.json();
  const items = json.result.results.map((r) => ({
    time: r["日期時間"],
    line: r["路線"],
    station: normStation(r["車站"]),
    text: String(r["說明"] ?? "").trim(),
    resolved: /修復完成|恢復|開放使用/.test(String(r["說明"] ?? "")),
  }));
  return { source: SOURCES.anomalies.dataset, fetchedAt: new Date().toISOString(), items };
}

const DS = "https://data.taipei/api/v1/dataset";

async function datastore(rid) {
  // 每次最多 1000 筆，分頁抓完並核對總數（分頁寫錯會少抓且不報錯）
  const out = [];
  let count = Infinity;
  for (let offset = 0; offset < count; offset += 1000) {
    const { result } = await (await get(`${DS}/${rid}?scope=resourceAquire&limit=1000&offset=${offset}`)).json();
    count = result.count;
    out.push(...result.results);
    if (!result.results.length) break;
  }
  if (out.length !== count) throw new Error(`${rid} 只抓到 ${out.length}/${count} 筆`);
  return out;
}

// 臺北捷運車站電梯維修預排時程表（最近 2 個月，每月一個檔）
async function fetchMaintenance() {
  const rids = ["5d76707a-4952-4405-8dbb-aa373bdd2146", "d93aadfb-9f78-4000-a73e-48870481bafc"];
  const rows = (await Promise.all(rids.map(datastore))).flat();
  const items = rows.map((r) => {
    const roc = String(r["民國年月日"]);
    const date = `${Number(roc.slice(0, 3)) + 1911}-${roc.slice(3, 5)}-${roc.slice(5, 7)}`;
    const loc = String(r["電梯位置"]);
    const slot = String(r["保養時段"]);
    return {
      date,
      station: normStation(r["車站"]),
      place: (loc.match(/\((.+)\)/) ?? [])[1] ?? loc, // 月台、出口1…
      isExit: loc.startsWith("EX"),
      night: slot.startsWith("N"),
    };
  });
  return {
    source: "https://data.taipei/dataset/detail?id=4f8b6fcd-5508-48fd-9b2f-98308ad1b0c4",
    note: "預定排程，不含臨時故障；實際以車站現場公告為準",
    fetchedAt: new Date().toISOString(),
    items,
  };
}

// 路網：相鄰兩站行駛時間（CSV Big5）＋轉乘站步行時間
const ROUTE_LINE = {
  "淡水-廣慈/奉天宮": "R", "北投-大安": "R", "北投-新北投": "R",
  "動物園-南港展覽館": "BR",
  "南港展覽館-頂埔": "BL", "南港展覽館-亞東醫院": "BL",
  "南勢角-迴龍": "O", "南勢角-蘆洲": "O",
  "松山-新店": "G", "松山-台電大樓": "G", "七張-小碧潭": "G",
  "新北產業園區-大坪林": "Y",
};

async function fetchNetwork() {
  const csvUrl = "https://data.taipei/api/dataset/513e97fe-6a98-4a0d-b7dc-11122c8638d4/resource/c32998fa-c9b2-4324-9016-e19fbe0815f1/download";
  const res = await get(csvUrl);
  if (!res.ok) throw new Error(`network HTTP ${res.status}`);
  const rows = parseCsv(new TextDecoder("big5").decode(await res.arrayBuffer()));
  const seen = new Set();
  const edges = [];
  for (const r of rows) {
    const line = ROUTE_LINE[r.stationbus];
    if (!line) throw new Error(`unknown route ${r.stationbus}`);
    const a = normStation(r.stationA), b = normStation(r.stationB);
    const key = [line, ...[a, b].sort()].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ line, a, b, sec: Number(r.traveltime) + Number(r.stoptime || 0) });
  }
  const walk = await datastore("14fd1af0-dc2b-4174-87d4-fcb9de783496");
  const transferMin = Object.fromEntries(walk.map((w) => [normStation(w.station), Number(w.time)]));
  return {
    sources: [
      "https://data.taipei/dataset/detail?id=513e97fe-6a98-4a0d-b7dc-11122c8638d4",
      "https://data.taipei/dataset/detail?id=782c2b71-8f5a-4575-9bf2-e86999be2863",
    ],
    fetchedAt: new Date().toISOString(),
    items: edges,
    transferMin,
  };
}

// 有引號欄位的 CSV（欄位內可能有換行與逗號）
function parseCsvQuoted(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const LINE_BY_NAME = { 文湖: "BR", 淡水信義: "R", 新北投: "R", 板南: "BL", 松山新店: "G", 小碧潭: "G", 中和新蘆: "O", 環狀: "Y" };
const lineCode = (name) => Object.entries(LINE_BY_NAME).find(([k]) => name.includes(k))?.[1] ?? null;

/** 「【文湖線】第1節。【板南線】第1節、第6節。」→ { BR: "第1節", BL: "第1節、第6節" }；沒有【】就套用到該站所有路線 */
function perLine(value, lines) {
  const v = String(value ?? "").trim();
  const clean = (t) => t.trim().replace(/[。；;]+$/, "");
  // 【】裡不是路線名（例：【往小碧潭列車…】）時整段照用
  if (!/【[^】]*線】/.test(v)) return Object.fromEntries(lines.map((l) => [l, clean(v)]));
  const out = {};
  for (const m of v.matchAll(/【([^】]+)】([^【]*)/g)) {
    for (const part of m[1].split("/")) {
      const l = lineCode(part);
      if (l) out[l] = clean(m[2]);
    }
  }
  return out;
}

async function fetchFacilities() {
  const buf = await (await get(SOURCES.facilities.url)).arrayBuffer();
  const rows = parseCsvQuoted(new TextDecoder("big5").decode(buf));
  const items = [];
  for (const r of rows) {
    // 路線以站碼為準（松江南京站的路線欄只寫中和新蘆線，站碼是 O08/G15）
    const lines = [...new Set(r.Station_Number.split("/").map((c) => c.trim().match(/^(BR|BL|R|G|O|Y)/)?.[1]).filter(Boolean))];
    const f = {
      wheelchairCars: perLine(r.Reserved_Spaces_for_Wheelchairs, lines),
      doorSide: perLine(r.Doors_Open_Side, lines),
      gate: perLine(r.Ticket_Gates_for_the_Disabled, lines),
      toilet: perLine(r.Toilet_Facilities_for_Disabled, lines),
      path: perLine(r.Tactile_Guide_Paths_quantity, lines),
    };
    for (const line of lines) {
      const pick = (o) => o[line] || null;
      const path = pick(f.path);
      items.push({
        station: normStation(r.Station_Name),
        line,
        wheelchairCars: pick(f.wheelchairCars),
        doorSide: pick(f.doorSide),
        gate: pick(f.gate),
        toilet: pick(f.toilet),
        // 這欄名稱寫「數量」，實際多數是動線文字；只有 0 的不用
        path: path && !/^[0/]$/.test(path) ? path : null,
      });
    }
  }
  return { source: SOURCES.facilities.dataset, fetchedAt: new Date().toISOString(), items };
}

await mkdir(OUT, { recursive: true });
for (const [name, fn] of [
  ["elevators", fetchElevators],
  ["anomalies", fetchAnomalies],
  ["maintenance", fetchMaintenance],
  ["network", fetchNetwork],
  ["facilities", fetchFacilities],
]) {
  const data = await fn();
  await writeFile(new URL(`${name}.json`, OUT), JSON.stringify(data, null, 1));
  console.log(`${name}: ${data.items.length} items`);
}
