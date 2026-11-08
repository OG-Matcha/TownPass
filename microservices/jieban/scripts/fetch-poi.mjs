// 建置時抓目的地地點（醫院、公園、區公所、圖書館、運動中心）存成 public/data/poi.json。
// 原因：data.taipei 不開 CORS、評審可能斷網 → 建置時抓好打包。每筆記來源資料集與查核時間。
// 用法：node scripts/fetch-poi.mjs
// 區公所資料集沒有座標 → 以 OpenStreetMap Nominatim 依機關名稱查（ODbL，建置時一次、每秒 1 筆），結果寫明 coordSource。
import { writeFile } from "node:fs/promises";

const OUT = new URL("../public/data/poi.json", import.meta.url);
const UA = "codefest2026-map-vue/0.1 (build-time POI fetch; github taipei codefest)";

const DS = {
  hospital: {
    dataset: "臺北市公私立醫院（臺北市政府衛生局）",
    url: "https://data.taipei/dataset/detail?id=b02cd6b2-79be-4d7f-ae78-305b2af668f5",
    api: "https://data.taipei/api/v1/dataset/eab7fdff-574d-427b-9324-c00833d695c8?scope=resourceAquire&limit=1000",
  },
  park: {
    dataset: "臺北市公園基本資料（臺北市政府工務局公園處；資源連到公園走透透 API）",
    url: "https://data.taipei/dataset/detail?id=ea732fb5-4bec-4be7-93f2-8ab91e74a6c6",
    api: "https://parks.gov.taipei/parks/api/",
  },
  library: {
    dataset: "臺北市立圖書館各分館暨民眾閱覽室（臺北市政府教育局）",
    url: "https://data.taipei/dataset/detail?id=43772803-6504-469c-894d-35904342a53b",
    api: "https://data.taipei/api/v1/dataset/fb6cc268-e2b8-43a7-86f2-e79702291a2b?scope=resourceAquire&limit=1000",
  },
  sports: {
    dataset: "臺北市各區運動中心（臺北市政府體育局）",
    url: "https://data.taipei/dataset/detail?id=80be7612-593f-4795-9935-a10ce0f7b75b",
    api: "https://data.taipei/api/v1/dataset/e7c46724-3517-4ce5-844f-5a4404897b7d?scope=resourceAquire&limit=1000",
  },
  tpech: {
    dataset: "臺北市立聯合醫院門診進度查詢（臺北市政府衛生局；含各院區地址）",
    url: "https://data.taipei/dataset/detail?id=8ee49ff0-600b-4e5a-81b2-41f712c5c801",
    api: "https://data.taipei/api/v1/dataset/5e508a50-cefd-49ae-8f1c-f7f867518553?scope=resourceAquire&limit=100",
  },
  office: {
    dataset: "臺北市政府各機關學校聯絡資訊（臺北市政府秘書處）",
    url: "https://data.taipei/dataset/detail?id=6b99dd93-9c63-43c9-96eb-0bfffce97217",
    api: "https://data.taipei/api/v1/dataset/d332914d-5119-4722-9861-77132b7f6e1c?scope=resourceAquire&limit=1000",
  },
};

async function getJson(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      if (res.ok) return res.json();
      last = new Error(`HTTP ${res.status} ${url}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  throw last;
}
const rows = async (url) => {
  const j = await getJson(url);
  const r = j.result;
  if (r.count !== r.results.length) throw new Error(`${url}: count ${r.count} != ${r.results.length}`);
  return r.results;
};
const num = (v) => {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n)) throw new Error(`bad number ${v}`);
  return n;
};
const inTaipei = (lat, lng) => lat > 24.95 && lat < 25.22 && lng > 121.45 && lng < 121.67;
const slug = (s) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
const checkedAt = new Date().toISOString();
const src = (k) => ({ dataset: DS[k].dataset, url: DS[k].url });

// ---- 醫院（36 家，自帶 WGS84 座標）----
// 第一個是畫面顯示的短名，其餘是大家實際會講的簡稱；順序 = 搜尋「醫院」沒給起點時的排序（醫學中心在前，衛福部醫院評鑑）
const HOSP_MAJOR = {
  國立台灣大學醫學院附設醫院: ["台大醫院（東址）", "台大醫院", "台大", "台大醫院東址", "台大東址"],
  臺北榮民總醫院: ["台北榮總", "榮總", "北榮", "榮民總醫院", "榮民醫院"],
  三軍總醫院附設民眾診療服務處: ["三軍總醫院", "三總", "內湖三總"],
  台灣基督長老教會馬偕醫療財團法人馬偕紀念醫院: ["馬偕紀念醫院", "馬偕", "馬偕醫院", "台北馬偕"],
  國泰醫療財團法人國泰綜合醫院: ["國泰綜合醫院", "國泰", "國泰醫院"],
  新光醫療財團法人新光吳火獅紀念醫院: ["新光醫院", "新光", "新光吳火獅紀念醫院"],
  臺北醫學大學附設醫院: ["北醫附設醫院", "北醫", "北醫附醫", "台北醫學大學附設醫院"],
  "臺北市立萬芳醫院-委託臺北醫學大學辦理": ["萬芳醫院", "萬芳", "市立萬芳醫院"],
  振興醫療財團法人振興醫院: ["振興醫院", "振興"],
  長庚醫療財團法人台北長庚紀念醫院: ["台北長庚醫院", "長庚", "台北長庚", "長庚醫院"],
  臺北市立聯合醫院: ["聯合醫院中興院區", "聯合醫院", "聯醫", "中興院區", "中興醫院", "聯醫中興", "市立聯合醫院"],
  國立臺灣大學醫學院附設醫院兒童醫院: ["台大兒童醫院", "台大兒醫", "兒童醫院"],
  國立臺灣大學醫學院附設醫院癌醫中心分院: ["台大癌醫中心", "台大癌醫", "癌醫中心"],
  國立臺灣大學醫學院附設醫院北護分院: ["台大北護分院", "北護分院", "台大北護"],
  醫療財團法人辜公亮基金會和信治癌中心醫院: ["和信治癌中心醫院", "和信", "和信醫院"],
  "臺北市立關渡醫院─委託臺北榮民總醫院經營": ["關渡醫院"],
  基督復臨安息日會醫療財團法人臺安醫院: ["臺安醫院", "臺安", "台安醫院"],
  中國醫藥大學附設醫院臺北分院: ["中國醫藥大學附設醫院臺北分院", "中國醫藥大學台北分院", "中國附醫台北"],
  康寧醫療財團法人康寧醫院: ["康寧醫院"],
  博仁綜合醫院: ["博仁綜合醫院", "博仁"],
  西園醫療社團法人西園醫院: ["西園醫院"],
  中心診所醫療財團法人中心綜合醫院: ["中心綜合醫院", "中心診所"],
  宏恩醫療財團法人宏恩綜合醫院: ["宏恩綜合醫院", "宏恩醫院"],
  中山醫療社團法人中山醫院: ["中山醫院"],
  三軍總醫院松山分院附設民眾診療服務處: ["三總松山分院", "松山分院"],
  三軍總醫院北投分院附設民眾診療服務處: ["三總北投分院", "北投分院"],
  財團法人台灣省私立台北仁濟院附設仁濟醫院: ["仁濟醫院"],
  同仁院醫療財團法人萬華醫院: ["萬華醫院"],
  "郵政醫院（委託中英醫療社團法人經營）": ["郵政醫院"],
  景美醫院: ["景美醫院"],
  秀傳醫院: ["秀傳醫院", "台北秀傳"],
  培靈醫院: ["培靈醫院"],
  協和婦女醫院: ["協和婦女醫院"],
  臺北市北投健康管理醫院: ["北投健康管理醫院"],
  德威國際牙醫口腔醫院: ["德威牙醫口腔醫院"],
};
const HOSP_ORDER = Object.keys(HOSP_MAJOR);
async function hospitals() {
  const r = await rows(DS.hospital.api);
  return r.map((x) => {
    const fullName = x["機構名稱"].trim();
    const [short, ...aliases] = HOSP_MAJOR[fullName] ?? [fullName];
    return {
      id: "h-" + slug(fullName).slice(0, 40),
      name: short,
      fullName,
      kind: "醫院",
      address: x["地址"].trim(),
      phone: x["電話"]?.trim() || null,
      lat: num(x["緯度"]),
      lng: num(x["經度"]),
      aliases,
      rank: HOSP_ORDER.indexOf(fullName) >= 0 ? HOSP_ORDER.indexOf(fullName) + 1 : 99,
      source: src("hospital"),
      checkedAt,
    };
  });
}

// ---- 公園（813 筆 → 面積 ≥ 2 公頃的主要公園；「XX號綠地」不是會講的目的地）----
async function parks() {
  const all = await getJson(DS.park.api);
  if (!Array.isArray(all) || all.length < 500) throw new Error(`parks api: ${all?.length}`);
  return all
    .filter((p) => Number(p.pm_LandPublicArea) >= 20000 && !/綠地|綠園|試驗中心/.test(p.pm_name))
    .map((p) => ({
      id: "p-" + slug(p.pm_name),
      name: p.pm_name.replace(/\(原.*?\)/, ""),
      kind: "公園",
      district: p.pm_regions,
      address: p.pm_location?.trim() || `${p.pm_regions}`,
      lat: num(p.pm_Latitude),
      lng: num(p.pm_Longitude),
      aliases: p.pm_name === "大安森林公園" ? ["大安公園", "森林公園"] : p.pm_name === "二二八和平公園" ? ["228公園", "二二八公園", "新公園"] : p.pm_name === "花博公園圓山園區" ? ["花博公園", "花博"] : p.pm_name === "士林官邸公園" ? ["士林官邸"] : [],
      rank: Number(p.pm_LandPublicArea) >= 60000 ? 1 : 2,
      areaM2: Number(p.pm_LandPublicArea),
      source: src("park"),
      checkedAt,
    }));
}

// ---- 圖書館（70 館；已閉館的不列）----
async function libraries() {
  const r = await rows(DS.library.api);
  return r
    .filter((x) => !/已閉館/.test(x["閱覽單位"]))
    .map((x) => {
      const unit = x["閱覽單位"].trim();
      const name = unit === "總館" ? "市立圖書館總館" : /分館|閱覽室|借還書|智慧館|智慧圖書館|紀念館|圖書館/.test(unit) ? `市立圖書館${unit}` : `市立圖書館${unit}`;
      return {
        id: "l-" + slug(unit),
        name,
        kind: "圖書館",
        address: x["地址"].trim(),
        phone: x["電話"]?.trim() || null,
        lat: num(x["緯度"]),
        lng: num(x["經度"]),
        aliases: unit === "總館" ? ["市圖總館", "北市圖", "總圖"] : [unit],
        rank: /分館|總館|紀念館|兒童圖書館/.test(unit) ? 1 : 2,
        source: src("library"),
        checkedAt,
      };
    });
}

// ---- 運動中心（12 區）----
async function sportsCenters() {
  const r = await rows(DS.sports.api);
  return r.map((x) => {
    const name = x["名稱"].trim();
    const short = name.replace(/暨.*$/, "");
    return {
      id: "s-" + slug(short),
      name,
      kind: "運動中心",
      address: x["地址"].trim(),
      phone: x["電話"]?.trim() || null,
      url: x["網址"]?.trim() || null,
      lat: num(x["緯度"]),
      lng: num(x["經度"]),
      aliases: short === name ? [short.replace("運動中心", "運動中心"), short.replace("運動中心", "") + "運中"] : [short, short.replace("運動中心", "") + "運中"],
      rank: 1,
      source: src("sports"),
      checkedAt,
    };
  });
}

// ---- 臺北市立聯合醫院各院區（長輩常去；「公私立醫院」資料集只有中興總院一筆）----
// 資料集只有地址 → Nominatim 以官方全名查 OSM 上標為醫院的點（實測 7 個院區都有）
const TPECH_ALIASES = {
  和平: ["和平醫院", "和平院區", "聯醫和平", "聯合醫院和平"],
  婦幼: ["婦幼醫院", "婦幼院區", "聯醫婦幼", "和平婦幼", "婦幼"],
  忠孝: ["忠孝醫院", "忠孝院區", "聯醫忠孝", "聯合醫院忠孝"],
  陽明: ["陽明醫院", "陽明院區", "聯醫陽明", "聯合醫院陽明"],
  松德: ["松德醫院", "松德院區", "聯醫松德", "市療"],
  林森: ["林森醫院", "林森院區", "林森中醫", "聯醫林森"],
  昆明: ["昆明醫院", "昆明院區", "聯醫昆明", "中醫醫院", "昆明中醫"],
};
async function tpechBranches() {
  const r = await rows(DS.tpech.api);
  const out = [];
  const seen = new Set();
  for (const x of r) {
    const full = x["院區"].trim();
    const m = full.match(/^臺北市立聯合醫院(.+?院區)(?:\((.+)\))?$/);
    if (!m) throw new Error(`院區名稱格式：${full}`);
    const key = (m[2] ?? m[1].replace(/院區$/, "")).replace(/中醫中心/, "昆明");
    if (key === "仁愛" || key === "中興" || seen.has(key)) continue; // 仁愛在 places.json、中興在公私立醫院資料集；昆明兩筆同址
    if (!TPECH_ALIASES[key]) throw new Error(`沒有簡稱表：${key}`);
    seen.add(key);
    const q = `臺北市立聯合醫院${key}院區`;
    const hit = (await nomi(`q=${encodeURIComponent(q)}`)).find((h) => (h.class === "amenity" || h.class === "building") && /hospital|clinic/.test(h.type) && h.display_name.includes(key));
    if (!hit) throw new Error(`geocode miss: ${q}`);
    const lat = Number(hit.lat), lng = Number(hit.lon);
    if (!inTaipei(lat, lng)) throw new Error(`geocode out of Taipei: ${q}`);
    console.log(q, lat, lng, hit.display_name.split(",")[0]);
    out.push({
      id: "h-tpech-" + slug(key),
      name: `聯合醫院${key}院區`,
      fullName: full,
      kind: "醫院",
      address: x["機構地址"].trim(),
      phone: x["機構電話"]?.trim() || null,
      lat,
      lng,
      aliases: TPECH_ALIASES[key],
      rank: 12,
      source: src("tpech"),
      coordSource: `OpenStreetMap ${hit.osm_type}/${hit.osm_id}「${hit.display_name.split(",")[0]}」（Nominatim，ODbL）`,
      checkedAt,
    });
  }
  if (out.length !== 7) throw new Error(`聯合醫院院區 ${out.length} != 7`);
  return out;
}

// ---- 區公所（12 區；資料集只有地址 → Nominatim 依名稱查座標）----
// Nominatim 對中文名稱會模糊配到不相干的點（例：「大安區公所」配到「福和變電所」）→ 只收 OSM 標成公所／政府機關、
// 而且名稱含該區名的結果；查不到就退回街道中心點（粗，寫明）。
const nomi = async (params) => {
  const j = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=tw&${params}`);
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim 使用規範：每秒最多 1 筆
  return j;
};
async function geocode(district, address) {
  const isOffice = (h) =>
    ((h.class === "amenity" && h.type === "townhall") || ((h.class === "office" || h.class === "building" || h.class === "landuse") && /government|commercial/.test(h.type))) &&
    h.display_name.includes(district) &&
    /公所|行政中心/.test(h.display_name.split(",")[0]);
  for (const q of [`臺北市${district}公所`, `${district}行政中心`, `${district}行政中心大樓`]) {
    const hit = (await nomi(`q=${encodeURIComponent(q)}`)).find(isOffice);
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), coordSource: `OpenStreetMap ${hit.osm_type}/${hit.osm_id}「${hit.display_name.split(",")[0]}」（Nominatim，ODbL）` };
  }
  // 街道中心點：地址去掉郵遞區號與樓層，取「X路Y段」或「X街」
  const street = address.replace(/^\d{5,6}\s*/, "").replace(/^臺北市.+?區/, "").match(/^[^\d]+?(路|街|大道)([一二三四五六七八九十\d]+段)?/)?.[0];
  if (street) {
    const hit = (await nomi(`q=${encodeURIComponent(`${street}, ${district}, 臺北市`)}`)).find((h) => h.class === "highway" && h.display_name.includes(district));
    if (hit) return { lat: Number(hit.lat), lng: Number(hit.lon), coordSource: `OpenStreetMap ${hit.osm_type}/${hit.osm_id} 街道中心點「${street}」（Nominatim，ODbL；粗略）` };
  }
  throw new Error(`geocode miss: ${district} ${address}`);
}
async function districtOffices() {
  const r = (await rows(DS.office.api)).filter((x) => /^臺北市.+區公所$/.test(x["機關名稱"].trim()));
  if (r.length !== 12) throw new Error(`區公所 ${r.length} != 12`);
  const out = [];
  for (const x of r) {
    const name = x["機關名稱"].trim();
    const district = name.replace(/^臺北市/, "").replace(/公所$/, "");
    const g = await geocode(district, x["地址"].trim());
    if (!inTaipei(g.lat, g.lng)) throw new Error(`geocode out of Taipei: ${name}`);
    console.log(name, g.lat, g.lng, g.coordSource);
    out.push({
      id: "o-" + slug(district),
      name: `${district}公所`,
      fullName: name,
      kind: "區公所",
      district,
      address: x["地址"].trim(),
      phone: x["總機電話一"]?.trim() || null,
      lat: g.lat,
      lng: g.lng,
      aliases: [`${district}行政中心`],
      rank: 1,
      source: src("office"),
      coordSource: g.coordSource,
      checkedAt,
    });
  }
  return out;
}

// Nominatim 每秒 1 筆：區公所與聯合醫院院區依序查，其餘並行
const [h, p, l, s] = await Promise.all([hospitals(), parks(), libraries(), sportsCenters()]);
const t = await tpechBranches();
const o = await districtOffices();
const items = [...h, ...t, ...p, ...l, ...s, ...o];
const bad = items.filter((x) => !inTaipei(x.lat, x.lng));
if (bad.length) console.warn("座標不在臺北市範圍，已剔除：", bad.map((x) => `${x.name} ${x.lat},${x.lng}`));
const ok = items.filter((x) => inTaipei(x.lat, x.lng));
const ids = new Set();
for (const x of ok) {
  if (ids.has(x.id)) throw new Error(`duplicate id ${x.id}`);
  ids.add(x.id);
}
await writeFile(OUT, JSON.stringify({ fetchedAt: checkedAt, sources: Object.values(DS).map(({ dataset, url }) => ({ dataset, url })), items: ok }, null, 1));
console.log(`醫院 ${h.length}＋聯合醫院院區 ${t.length}、公園 ${p.length}、圖書館 ${l.length}、運動中心 ${s.length}、區公所 ${o.length} → ${ok.length} 筆`);
