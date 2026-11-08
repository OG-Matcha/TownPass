// 目的地理解・規則層（純函式，不碰 Vue；node --experimental-strip-types 可直接測）。
// 三層：縮寫詞典（北車、榮總、101…）→ 名稱／簡稱比對（臺/台同字、去掉「我要去」這類口語）→ 容錯（語音辨識錯字：台北車戰→台北車站）。
// 語意層（看病→醫院）在 placeSearch.ts，規則沒中才用。
export type PoiLite = {
  id: string;
  /** 畫面顯示的短名（台北榮總）；官方全名在 fullName */
  name: string;
  fullName?: string;
  kind: string;
  address?: string;
  lat: number;
  lng: number;
  aliases?: string[];
  rank?: number;
  district?: string;
};
export type EntranceLite = { station: string; exit: string; lat: number; lng: number; kind: "elevator" | "ramp" };
export type Near = { station: string; exit: string; kind: "elevator" | "ramp"; meters: number };
export type Why = "alias" | "name" | "fuzzy" | "semantic";
/** 規則層的命中：還沒換成畫面用的 PlaceHit（placeSearch.ts 負責補站名、出口） */
export type RuleHit =
  | { type: "station"; station: string; why: Why; score: number }
  | { type: "place" | "poi"; poi: PoiLite; why: Why; score: number };

export const norm = (s: string) =>
  s
    .replaceAll("臺", "台")
    .replace(/[\s，。,.!！?？、~～「」『』()（）]/g, "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toLowerCase();

// ---- 口語：去掉「我要去」「帶我到」「那邊」「好不好」----
const LEAD = /^(?:請|麻煩|幫我|幫忙|拜託|欸|嘿|喂|那個|嗯)*(?:我|我們|阿嬤|阿公|媽媽|爸爸)?(?:要|想|想要|需要|打算|得|該|可以|能不能|能|是不是)?(?:去|到|往|前往|回|找|帶我去|帶我到|載我去|送我去|陪我去|帶我回|去一下|去一趟|過去)?(?:一下|一趟)?/;
const TAIL = /(?:那邊|那裡|這邊|附近|一下|一趟|好不好|可不可以|可以嗎|行不行|好嗎|嗎|吧|呢|啊|喔|欸|耶|啦|哦|謝謝|拜託|怎麼走|怎麼去|要怎麼去|怎麼搭|搭捷運|坐捷運|坐車|搭車|要怎麼走|的路|的捷運|路線|在哪|在哪裡|在哪邊|是哪一站|哪一站|哪站)+$/;
/** 去掉口語填充詞，留下地名部分；「從X到Y」取 Y。 */
export function stripFiller(raw: string): string {
  let t = norm(raw);
  const m = t.match(/^(?:我|我們)?(?:要|想|想要)?從(.*?)(?:出發)?(?:去|到|往|前往|至)(.+)$/);
  if (m) t = m[2];
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(LEAD, "").replace(TAIL, "");
  }
  return t;
}

// ---- 縮寫詞典（台灣人實際會講的）：key → 目標名稱（車站名、地點名或分類）。多個目標 = 歧義，全部回傳讓使用者選 ----
// 目標寫法：「XX站」= 捷運站；「#分類」= 分類搜尋；其他 = 地點名（places.json 或 poi.json 的名稱／簡稱，啟動時解析）
export const SHORTCUTS: Record<string, string[]> = {
  // 車站、交通
  北車: ["台北車站"],
  台北火車站: ["台北車站"],
  火車站: ["台北車站"],
  台鐵: ["台北車站"],
  高鐵: ["台北車站"],
  高鐵站: ["台北車站"],
  轉運站: ["台北車站"],
  台北轉運站: ["台北車站"],
  京站: ["台北車站"],
  站前: ["台北車站"],
  新光三越站前店: ["台北車站"],
  客運: ["台北車站"],
  松山火車站: ["松山站"],
  松山車站: ["松山站"],
  南港火車站: ["南港站"],
  南港車站: ["南港站"],
  南港高鐵: ["南港站"],
  松機: ["松山機場站"],
  機場: ["松山機場站"],
  松山機場: ["松山機場站"],
  // 市政、公家
  市府: ["市政府站"],
  市政府: ["市政府站"],
  台北市政府: ["市政府站"],
  市政府大樓: ["市政府站"],
  社會局: ["市政府站"],
  勞動局: ["市政府站"],
  衛生局: ["市政府站"],
  教育局: ["市政府站"],
  台北探索館: ["市政府站"],
  地方法院: ["小南門站"],
  台北地院: ["小南門站"],
  法院: ["小南門站"],
  北門郵局: ["北門站"],
  郵政總局: ["北門站"],
  總統府: ["台大醫院站"],
  立法院: ["善導寺站"],
  監察院: ["善導寺站"],
  戶政: ["#區公所"],
  戶政事務所: ["#區公所"],
  公所: ["#區公所"],
  // 地標、商圈、夜市
  "101": ["台北101/世貿站"],
  台北101: ["台北101/世貿站"],
  一零一: ["台北101/世貿站"],
  一〇一: ["台北101/世貿站"],
  世貿: ["台北101/世貿站"],
  信義計畫區: ["台北101/世貿站"],
  信義商圈: ["市政府站"],
  信義誠品: ["市政府站"],
  新光三越信義: ["市政府站"],
  大巨蛋: ["國父紀念館站"],
  巨蛋: ["國父紀念館站", "台北小巨蛋站"],
  台北大巨蛋: ["國父紀念館站"],
  國館: ["國父紀念館站"],
  國父紀念館: ["國父紀念館站"],
  松菸: ["國父紀念館站"],
  松山文創: ["國父紀念館站"],
  松山文創園區: ["國父紀念館站"],
  小巨蛋: ["台北小巨蛋站"],
  台北體育館: ["台北小巨蛋站"],
  田徑場: ["台北小巨蛋站"],
  西門町: ["西門站"],
  西門: ["西門站"],
  紅樓: ["西門站"],
  南展: ["南港展覽館站"],
  展覽館: ["南港展覽館站"],
  南港展覽館: ["南港展覽館站"],
  南軟: ["南港軟體園區站"],
  內科: ["港墘站"],
  內湖科學園區: ["港墘站"],
  美麗華: ["劍南路站"],
  大直: ["大直站"],
  動物園: ["動物園站"],
  木柵動物園: ["動物園站"],
  貓纜: ["動物園站"],
  貓空: ["動物園站"],
  士林夜市: ["劍潭站"],
  饒河夜市: ["松山站"],
  饒河街: ["松山站"],
  寧夏夜市: ["雙連站"],
  師大夜市: ["台電大樓站"],
  師大: ["台電大樓站"],
  台大: ["國立臺灣大學醫學院附設醫院（西址）", "公館站"],
  台灣大學: ["公館站"],
  台大校園: ["公館站"],
  台大校區: ["公館站"],
  公館: ["公館站"],
  故宮: ["士林站"],
  故宮博物院: ["士林站"],
  天文館: ["士林站"],
  科教館: ["士林站"],
  兒童新樂園: ["士林站"],
  兒樂: ["士林站"],
  中正紀念堂: ["中正紀念堂站"],
  兩廳院: ["中正紀念堂站"],
  國家音樂廳: ["中正紀念堂站"],
  國家戲劇院: ["中正紀念堂站"],
  龍山寺: ["龍山寺站"],
  艋舺: ["龍山寺站"],
  行天宮: ["行天宮站"],
  孔廟: ["圓山站"],
  保安宮: ["圓山站"],
  花博: ["花博公園圓山園區"],
  花博公園: ["花博公園圓山園區"],
  華山: ["忠孝新生站"],
  華山文創: ["忠孝新生站"],
  光華商場: ["忠孝新生站"],
  三創: ["忠孝新生站"],
  迪化街: ["大橋頭站"],
  大稻埕: ["大橋頭站"],
  永康街: ["東門站"],
  東區: ["忠孝敦化站"],
  陽明山: ["陽明公園"],
  象山: ["象山站"],
  淡水老街: ["淡水站"],
  漁人碼頭: ["淡水站"],
  北投溫泉: ["新北投站"],
  溫泉: ["新北投站"],
  關渡宮: ["關渡站"],
  永和: ["頂溪站", "永安市場站"],
  中和: ["中和站"],
  板橋車站: ["板橋站"],
  板橋火車站: ["板橋站"],
  // 醫院（poi.json 的簡稱之外，再補口語）
  台大東址: ["國立台灣大學醫學院附設醫院"],
  台大西址: ["國立臺灣大學醫學院附設醫院（西址）"],
  榮總: ["臺北榮民總醫院"],
  北榮: ["臺北榮民總醫院"],
  石牌榮總: ["臺北榮民總醫院"],
  馬偕: ["台灣基督長老教會馬偕醫療財團法人馬偕紀念醫院"],
  三總: ["三軍總醫院附設民眾診療服務處"],
  國泰: ["國泰醫療財團法人國泰綜合醫院"],
  新光: ["新光醫療財團法人新光吳火獅紀念醫院"],
  北醫: ["臺北醫學大學附設醫院"],
  萬芳: ["臺北市立萬芳醫院-委託臺北醫學大學辦理"],
  長庚: ["長庚醫療財團法人台北長庚紀念醫院"],
  聯合醫院: ["臺北市立聯合醫院", "臺北市立聯合醫院仁愛院區"],
  聯醫: ["臺北市立聯合醫院", "臺北市立聯合醫院仁愛院區"],
  仁愛: ["臺北市立聯合醫院仁愛院區"],
  // 大安、松山、南港這種同名：車站、公園、運動中心都可能
  大安: ["大安站", "大安森林公園站"],
  松山: ["松山站", "松山機場站"],
  南港: ["南港站", "南港展覽館站"],
  中山: ["中山站", "中山運動中心"],
  // 市府場館（places.json）
  北美館: ["臺北市立美術館"],
  市美館: ["臺北市立美術館"],
  美術館: ["臺北市立美術館"],
  市圖: ["臺北市立圖書館總館"],
  市圖總館: ["臺北市立圖書館總館"],
  北市圖: ["臺北市立圖書館總館"],
  總圖: ["臺北市立圖書館總館"],
  圖書館總館: ["臺北市立圖書館總館"],
  輔具中心: ["臺北市西區輔具中心"],
  志工中心: ["臺北市志願服務推廣中心"],
  就服站: ["臺北市就業服務處 景美就業服務站", "臺北市就業服務處 北投就業服務站"],
  就業服務站: ["臺北市就業服務處 景美就業服務站", "臺北市就業服務處 北投就業服務站"],
  勞動力重建運用處: ["臺北市勞動力重建運用處（身心障礙者求職服務）"],
  // 分類
  醫院: ["#醫院"],
  公園: ["#公園"],
  區公所: ["#區公所"],
  圖書館: ["#圖書館"],
  運動中心: ["#運動中心"],
  運中: ["#運動中心"],
  游泳池: ["#運動中心"],
  健身房: ["#運動中心"],
};
export const CATEGORIES = ["醫院", "公園", "區公所", "圖書館", "運動中心"] as const;

// ---- 名稱形式 ----
// places.json（市府場館）大家實際會講的簡稱；poi.json 的簡稱寫在資料裡（scripts/fetch-poi.mjs）
export const PLACE_ALIASES: Record<string, string[]> = {
  "ntuh-west": ["台大醫院", "台大西址", "台大醫院西址", "台大"],
  "tpech-renai": ["仁愛醫院", "聯合醫院仁愛", "仁愛院區", "聯醫仁愛"],
  "tpml-main-library": ["市圖總館", "北市圖", "市圖", "總圖", "圖書館總館", "市立圖書館"],
  "taipei-fine-arts-museum": ["北美館", "市美館", "市立美術館", "美術館"],
  "zhongzheng-sports-center": ["中正運動中心", "中正運中"],
  "taipei-west-assistive-device-center": ["西區輔具中心", "輔具中心", "輔具"],
  "zhongzheng-district-office": ["中正區公所", "中正公所"],
  "taipei-volunteer-center": ["志願服務推廣中心", "志工中心"],
  "eso-jingmei-station": ["景美就業服務站", "景美就服站"],
  "eso-beitou-station": ["北投就業服務站", "北投就服站"],
  "fd-disability-employment": ["勞動力重建運用處", "身障就業服務", "身心障礙者求職服務"],
};
const PREFIX_RE = /^(台北市立|台北市政府|台北市|市立|國立台灣大學|國立|財團法人|醫療財團法人|社團法人)/;
/** 一個地點大家會講的所有寫法：全名、去掉「臺北市立」、簡稱 */
export function formsOf(p: PoiLite): string[] {
  const out: string[] = [];
  for (const n of [p.name, p.fullName ?? ""]) {
    if (!n) continue;
    const base = norm(n.replace(/[（(].*?[)）]/g, "").replace(/[-─].*$/, "").replace(/暨.*$/, ""));
    out.push(base, base.replace(PREFIX_RE, ""));
    // 「XX醫療財團法人XX醫院」→ 法人名後面的醫院名
    const m = base.match(/(?:法人|社團法人|財團法人)(.+)$/);
    if (m) out.push(m[1]);
  }
  out.push(...(p.aliases ?? []).map(norm), ...(PLACE_ALIASES[p.id] ?? []).map(norm));
  return [...new Set(out)].filter((f) => f.length >= 2);
}
export function stationForms(st: string): string[] {
  const s = norm(st);
  const short = s.endsWith("車站") ? s : s.replace(/站$/, "");
  const parts = short.split("/").filter((x) => x.length >= 2);
  return [...new Set([s, short, ...parts, ...parts.map((x) => x + "站")])].filter((f) => f.length >= 2);
}

// ---- 容錯：編輯距離，同音／形近字算半個錯 ----
const HOMO_GROUPS = [
  "站戰佔棧斬讚", "園圓員元原源", "館管關觀", "醫衣一依", "院願遠", "公工宮功攻", "所鎖索", "湖胡壺護", "林琳臨鄰", "山三杉珊",
  "投頭透偷", "門們捫", "市是事式視", "府付副輔父", "北杯背貝", "台抬颱臺", "大達打", "總縱宗綜", "榮融容蓉", "國果過",
  "紀記技季", "念唸", "堂糖唐塘", "龍籠隆", "寺四是", "書舒輸", "圖途塗土徒", "動洞凍", "物務霧", "新心辛欣信", "南男難",
  "港講", "展盞", "覽懶籃", "運韻孕", "中鐘忠終", "區曲驅", "仁人任", "愛艾礙", "和河何荷", "平萍評", "美每梅", "術樹數述",
  "淡蛋但", "水睡", "石十時實", "牌排", "士世事室式", "劍健建見", "潭談彈", "雙爽", "連蓮練", "忠中鐘", "孝笑校效", "復復福",
  "興星行", "敦頓", "化畫話花", "古股鼓", "亭停庭", "景井警", "萬晚碗", "芳方房", "松鬆", "機雞基", "場廠長", "橋喬",
  "頭投", "安按案", "森深", "民明名", "權全泉", "西希", "湖胡", "軟阮", "體替", "輔府父", "具據聚", "就舊", "業夜", "服福",
];
const HOMO = new Map<string, number>();
HOMO_GROUPS.forEach((g, i) => [...g].forEach((c) => HOMO.set(c, i)));
const subCost = (a: string, b: string) => (a === b ? 0 : HOMO.has(a) && HOMO.get(a) === HOMO.get(b) ? 0.5 : 1);
export function editDistance(a: string, b: string): number {
  const A = [...a];
  const B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + subCost(A[i - 1], B[j - 1]));
    prev = cur;
  }
  return prev[B.length];
}
/** 容錯上限：3～4 字容 1 錯、5 字以上容 2 錯（同音字算半個）；2 字只容同音字 */
const tolerance = (len: number) => (len <= 2 ? 0.5 : len <= 4 ? 1 : 2);
// 「和平醫院」「忠孝院區」這類：字尾是通用詞，真正能分辨的是前面的字。容錯只比前面的字，
// 不然「和平醫院」會配到「和信醫院」（差一個字），指到完全不同的醫院。
const GENERIC_SUFFIX = /(醫院|院區|分院|分館|圖書館|運動中心|區公所|公所|公園|車站|站)$/;
/** 「XX醫院」這種具體名字（規則沒中）→ 語意層也不該拿地點名去配別家；placeSearch 用 */
export const looksLikeSpecificName = (t: string) => GENERIC_SUFFIX.test(t) && splitSuffix(t)[0].length > 0;
const splitSuffix = (s: string): [string, string] => {
  const m = s.match(GENERIC_SUFFIX);
  return m ? [s.slice(0, -m[1].length), m[1]] : [s, ""];
};
/** 容錯距離；查詢有通用字尾時，字尾要一樣、只比前面的字，回傳 null 表示不該配 */
function fuzzyDistance(t: string, form: string): number | null {
  const [tHead, tSuf] = splitSuffix(t);
  if (!tSuf || !tHead) return editDistance(t, form) <= tolerance(t.length) ? editDistance(t, form) : null;
  const [fHead, fSuf] = splitSuffix(form);
  if (fSuf !== tSuf || !fHead || Math.abs(fHead.length - tHead.length) > tolerance(tHead.length)) return null;
  const d = editDistance(tHead, fHead);
  return d <= tolerance(tHead.length) ? d : null;
}

// ---- 距離 ----
export const meters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180;
  const h = Math.sin(((bLat - aLat) * r) / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(((bLng - aLng) * r) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
};
/** 離地點最近的無障礙出入口（電梯或坡道，直線距離）；電梯優先：同站有電梯就不報坡道 */
export function nearestEntrance(p: { lat: number; lng: number }, list: EntranceLite[]): Near | null {
  let best: Near | null = null;
  for (const e of list) {
    const m = meters(p.lat, p.lng, e.lat, e.lng);
    if (!best || m < best.meters) best = { station: e.station, exit: e.exit.startsWith("出口") || e.exit.startsWith("單一") ? e.exit : `出口${e.exit}`, kind: e.kind, meters: m };
  }
  return best;
}
/** 車站位置：所有無障礙出入口的平均座標 */
export function stationPoint(station: string, list: EntranceLite[]): { lat: number; lng: number } | null {
  const es = list.filter((e) => e.station === station);
  if (!es.length) return null;
  return { lat: es.reduce((s, e) => s + e.lat, 0) / es.length, lng: es.reduce((s, e) => s + e.lng, 0) / es.length };
}

// ---- 索引 ----
export type Index = {
  stations: string[];
  pois: PoiLite[]; // places.json（type place）與 poi.json（type poi）合併；重複的以 places.json 為準
  placeIds: Set<string>;
  forms: { form: string; hit: RuleHit }[];
  /** 縮寫詞典：hand = 上面手寫的 SHORTCUTS；open = 公開資料別名（public/data/aliases.json，scripts/fetch-aliases.mjs 產生） */
  shortcuts: { key: string; hits: RuleHit[]; source?: "hand" | "open" }[];
};
/** 公開資料別名（Wikidata／OpenStreetMap／內政部地名資料），建置時抓好；target 指到索引裡已有的車站、地點 */
export type OpenAlias = { alias: string; target: { type: "station" | "place" | "poi"; id: string }; source: string; license: string; via?: string; meters?: number };
export function buildIndex(stations: string[], places: PoiLite[], pois: PoiLite[], openAliases: OpenAlias[] = []): Index {
  const placeForms = new Set(places.flatMap(formsOf));
  // poi.json 和 places.json 重複（同名、或同種類且 150 公尺內）→ 留 places.json 那筆（有查核過的無障礙資訊）
  const dedupedPois = pois.filter((p) => !formsOf(p).some((f) => placeForms.has(f)) && !places.some((q) => q.kind === p.kind && meters(p.lat, p.lng, q.lat, q.lng) < 150));
  const all = [...places, ...dedupedPois];
  const placeIds = new Set(places.map((p) => p.id));
  const forms: Index["forms"] = [];
  for (const s of stations) for (const f of stationForms(s)) forms.push({ form: f, hit: { type: "station", station: s, why: "name", score: 1 } });
  for (const p of all) for (const f of formsOf(p)) forms.push({ form: f, hit: { type: placeIds.has(p.id) ? "place" : "poi", poi: p, why: "name", score: 1 } });
  const byName = new Map<string, RuleHit>();
  for (const s of stations) byName.set(norm(s), { type: "station", station: s, why: "alias", score: 1 });
  for (const p of all) for (const f of formsOf(p)) if (!byName.has(f)) byName.set(f, { type: placeIds.has(p.id) ? "place" : "poi", poi: p, why: "alias", score: 1 });
  const shortcuts: Index["shortcuts"] = [];
  for (const [k, targets] of Object.entries(SHORTCUTS)) {
    const hits: RuleHit[] = [];
    for (const t of targets) {
      if (t.startsWith("#")) continue; // 分類另外處理
      const h = formsOf({ id: "", name: t, kind: "", lat: 0, lng: 0 }).map((f) => byName.get(f)).find(Boolean);
      if (h) hits.push(h);
    }
    shortcuts.push({ key: norm(k), hits, source: "hand" });
  }
  // 公開資料別名：手寫詞典已有的 key 以手寫為準（手寫的有人判斷過要去哪一站）；同一別名多個目標 = 歧義
  const handKeys = new Set(shortcuts.map((s) => s.key));
  const stationSet = new Set(stations);
  const byId = new Map(all.map((p) => [p.id, p]));
  const open = new Map<string, RuleHit[]>();
  for (const a of openAliases) {
    const key = norm(a.alias);
    if (key.length < 2 || handKeys.has(key)) continue;
    let h: RuleHit | null = null;
    if (a.target.type === "station") h = stationSet.has(a.target.id) ? { type: "station", station: a.target.id, why: "alias", score: 1 } : null;
    else {
      const p = byId.get(a.target.id);
      h = p ? { type: placeIds.has(p.id) ? "place" : "poi", poi: p, why: "alias", score: 1 } : null;
    }
    if (!h) continue;
    const list = open.get(key) ?? [];
    list.push(h);
    open.set(key, list);
  }
  for (const [key, hits] of open) shortcuts.push({ key, hits: dedupe(hits), source: "open" });
  return { stations, pois: all, placeIds, forms, shortcuts };
}

/** 詞典目標名稱解析不到（資料改了）→ 檢查腳本用 */
export function unresolvedShortcuts(idx: Index): string[] {
  return idx.shortcuts.filter((s) => s.source !== "open" && s.hits.length === 0 && !(SHORTCUTS[s.key] ?? []).every((t) => t.startsWith("#"))).map((s) => s.key);
}

const dedupe = (hits: RuleHit[]): RuleHit[] => {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const k = h.type === "station" ? `st:${h.station}` : h.poi.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const keyOf = (h: RuleHit) => (h.type === "station" ? `st:${h.station}` : h.poi.id);

/** 分類搜尋：有起點就回離起點最近的；沒有就依 rank、名稱 */
export function categoryHits(idx: Index, kind: string, entrances: EntranceLite[], origin: string | null | undefined, limit: number): RuleHit[] {
  const list = idx.pois.filter((p) => p.kind === kind);
  const o = origin ? stationPoint(origin, entrances) : null;
  const sorted = o
    ? list.map((p) => ({ p, d: meters(o.lat, o.lng, p.lat, p.lng) })).sort((a, b) => a.d - b.d).map((x) => x.p)
    : [...list].sort((a, b) => (a.rank ?? 2) - (b.rank ?? 2) || a.name.localeCompare(b.name, "zh-Hant"));
  return sorted.slice(0, limit).map((p) => ({ type: idx.placeIds.has(p.id) ? "place" : "poi", poi: p, why: "alias", score: 0.9 }) as RuleHit);
}

export type RuleResult = { hits: RuleHit[]; category: string | null; text: string };
/** 規則層：詞典 → 名稱 → 容錯。回傳依分數排序；category 非空表示是分類查詢（hits 已是該分類最近／主要的幾筆）。 */
export function searchByRules(idx: Index, raw: string, entrances: EntranceLite[], opts: { limit?: number; origin?: string | null } = {}): RuleResult {
  const limit = opts.limit ?? 3;
  const t = stripFiller(raw);
  const full = norm(raw);
  const empty = { hits: [], category: null, text: t };
  if (!t) return empty;

  // 1. 詞典：整句等於 key（含分類）；或句子裡含 key（取最長的）
  const catOf = (text: string) => {
    const s = SHORTCUTS[text];
    if (!s) return null;
    const c = s.find((x) => x.startsWith("#"));
    return c ? c.slice(1) : null;
  };
  const exactCat = catOf(t) ?? (CATEGORIES.includes(t as (typeof CATEGORIES)[number]) ? t : null);
  if (exactCat) return { hits: categoryHits(idx, exactCat, entrances, opts.origin, limit), category: exactCat, text: t };
  const exact = idx.shortcuts.find((s) => s.key === t);
  if (exact && exact.hits.length && exact.source !== "open") return { hits: exact.hits.slice(0, Math.max(limit, exact.hits.length)).map((h) => ({ ...h, why: "alias", score: 1 })), category: null, text: t };

  // 2. 名稱／簡稱：整句等於某個寫法 → 1.0；句子含寫法 → 依寫法占句子的比例；寫法以句子開頭（打到一半）→ 0.7
  const scored = new Map<string, RuleHit>();
  const put = (h: RuleHit) => {
    const k = keyOf(h);
    const old = scored.get(k);
    if (!old || old.score < h.score) scored.set(k, h);
  };
  // 公開資料別名整句命中：不像手寫詞典那樣直接定案，和名稱比對一起排（例：「忠孝醫院」Wikidata 指的是國父紀念館站旁的
  // 私立忠孝醫院，但市民也這樣叫聯合醫院忠孝院區 → 兩個都列出來讓人選）
  if (exact && exact.hits.length && exact.source === "open") for (const h of exact.hits) put({ ...h, why: "alias", score: 0.97 });
  for (const { form, hit } of idx.forms) {
    if (form === t || form === full) put({ ...hit, why: "name", score: 1 });
    else if (t.length >= 2 && t.includes(form)) put({ ...hit, why: "name", score: 0.8 + (0.15 * form.length) / t.length });
    else if (t.length >= 2 && form.startsWith(t)) put({ ...hit, why: "name", score: 0.6 + (0.1 * t.length) / form.length });
  }
  // 句子含詞典 key（例：「我想去北車附近」）
  if (!scored.size) {
    let best: { key: string; hits: RuleHit[] } | null = null;
    for (const s of idx.shortcuts) if (s.hits.length && t.includes(s.key) && (!best || s.key.length > best.key.length)) best = s;
    if (best) for (const h of best.hits) put({ ...h, why: "alias", score: 0.85 });
  }

  // 3. 容錯（語音辨識錯字）：沒有整句命中才做；幾乎全對（差半個同音字）要贏過「只對到前兩個字」的部分命中
  const bestSoFar = Math.max(0, ...[...scored.values()].map((h) => h.score));
  if (bestSoFar < 0.95 && t.length >= 3) {
    const tol = tolerance(t.length);
    for (const { form, hit } of idx.forms) {
      if (Math.abs(form.length - t.length) > tol) continue;
      const d = fuzzyDistance(t, form);
      if (d !== null) put({ ...hit, why: "fuzzy", score: 0.92 - d * 0.1 });
    }
    for (const s of idx.shortcuts) {
      if (!s.hits.length || Math.abs(s.key.length - t.length) > tol) continue;
      const d = fuzzyDistance(t, s.key);
      if (d !== null) for (const h of s.hits) put({ ...h, why: "fuzzy", score: 0.92 - d * 0.1 });
    }
  }
  // 4. 句子含分類詞但沒對到任何地點名（「附近的醫院」「醫院在哪」）→ 分類。
  //    分類詞前面有具體名字（「新興醫院」：不在資料裡）→ 不回別家，回空讓使用者換個說法
  if (!scored.size) {
    const cat = CATEGORIES.find((c) => t.includes(c));
    if (cat) {
      const head = t.slice(0, t.indexOf(cat));
      if (!head || /^(?:附近|最近|離我最近|哪一?[家間]|一[家間]|的|找|去|大|有沒有|有)+的?$/.test(head))
        return { hits: categoryHits(idx, cat, entrances, opts.origin, limit), category: cat, text: t };
    }
  }
  const hits = dedupe([...scored.values()].sort((a, b) => b.score - a.score || tie(a, b)));
  return { hits: hits.slice(0, limit), category: null, text: t };
}
// 同分：地點（有查核資料）> 車站 > 開放資料地點；再依 rank
const tie = (a: RuleHit, b: RuleHit) => {
  const w = (h: RuleHit) => (h.type === "place" ? 0 : h.type === "station" ? 1 : 2 + (h.poi.rank ?? 2) * 0.1);
  return w(a) - w(b);
};
