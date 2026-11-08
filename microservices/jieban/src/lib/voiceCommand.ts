// 「用講的」：把一句話轉成畫面上的動作。純文字規則，不用模型，斷網也能用。
// 支援 5 種指令：
//   1. 起訖站：「從小南門到台大醫院」「我要去淡水」「小南門到台大醫院」
//   2. 日期：「今天」「明天」「後天」「11月30號」
//   3. 規劃：「幫我規劃」「怎麼走」「查一下」
//   4. 念出來：「念給我聽」「唸出來」
//   5. 放大字：「字大一點」「放大」「字小一點」

export type VoiceCommand =
  | { type: "route"; from?: string; to?: string }
  | { type: "date"; date: string }
  | { type: "plan" }
  | { type: "speak" }
  | { type: "font"; bigger: boolean };

/** 名稱正規化：臺→台、去掉「站」與空白、全形數字轉半形。 */
function norm(s: string) {
  return s
    .replace(/臺/g, "台")
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, "");
}
const bare = (station: string) => norm(station).replace(/站$/, "");

/** 在文字中找出現的站名，回傳依出現位置排序；長的名字優先（「台北車站」不會被「台北」吃掉）。 */
export function findStations(text: string, stations: string[]): { station: string; at: number }[] {
  const t = norm(text);
  // 「台北101/世貿站」拆成「台北101」「世貿」兩個說法
  const names = stations
    .flatMap((s) => bare(s).split("/").map((b) => ({ s, b })))
    .sort((x, y) => y.b.length - x.b.length);
  const taken: [number, number][] = [];
  const out: { station: string; at: number }[] = [];
  for (const { s, b } of names) {
    if (!b) continue;
    let i = t.indexOf(b);
    while (i >= 0) {
      const end = i + b.length;
      if (!taken.some(([a, z]) => i < z && end > a) && !out.some((o) => o.station === s)) {
        taken.push([i, end]);
        out.push({ station: s, at: i });
        break;
      }
      i = t.indexOf(b, i + 1);
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function cnToInt(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  // 支援到 31：十一、二十、三十一
  if (s.includes("十")) {
    const [a, b] = s.split("十");
    return (a ? CN_NUM[a] : 1) * 10 + (b ? CN_NUM[b] : 0);
  }
  return CN_NUM[s] ?? NaN;
}

function iso(d: Date) {
  return d.toLocaleDateString("sv-SE");
}

/** 解析一句話，可能同時有多個指令（例：「明天從小南門到台大醫院，幫我規劃」）。 */
export function parseVoice(text: string, stations: string[], today = new Date()): VoiceCommand[] {
  const t = norm(text);
  const out: VoiceCommand[] = [];

  // 字級
  if (/(字|按鈕).{0,2}(大|放大)|放大|看不清楚/.test(t)) out.push({ type: "font", bigger: true });
  else if (/(字|按鈕).{0,2}小|縮小/.test(t)) out.push({ type: "font", bigger: false });

  // 日期
  const rel = t.match(/(今天|明天|後天)/);
  const md = t.match(/(\d+|[一二三四五六七八九十]+)月(\d+|[一二三四五六七八九十]+)[日號号]/);
  if (md) {
    const m = cnToInt(md[1]);
    const d = cnToInt(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let y = today.getFullYear();
      const cand = new Date(y, m - 1, d);
      if (cand < new Date(today.getFullYear(), today.getMonth(), today.getDate())) y += 1; // 已過的日期 → 明年
      out.push({ type: "date", date: iso(new Date(y, m - 1, d)) });
    }
  } else if (rel) {
    const add = { 今天: 0, 明天: 1, 後天: 2 }[rel[1] as "今天" | "明天" | "後天"];
    out.push({ type: "date", date: iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + add)) });
  }

  // 起訖站
  const found = findStations(t, stations);
  if (found.length) {
    if (found.length >= 2) {
      out.push({ type: "route", from: found[0].station, to: found[1].station });
    } else {
      // 只有一站：「從／在 X」或「X 出發／上車」是起點，其他都當終點（「我要去淡水」最常見）
      const before = t.slice(0, found[0].at);
      const after = t.slice(found[0].at);
      const isFrom = /(從|在)$/.test(before) || /^[^到去往至]*(出發|上車)/.test(after);
      out.push(isFrom ? { type: "route", from: found[0].station } : { type: "route", to: found[0].station });
    }
  }

  // 念出來
  if (/(念|唸|讀|說)(給我聽|出來|一次)/.test(t)) out.push({ type: "speak" });
  // 規劃：明說要規劃，或有起訖站
  if (/(規劃|怎麼走|怎麼去|查一下|幫我查|路線)/.test(t)) out.push({ type: "plan" });

  return out;
}

// ---- 路上（一步一步）：手被佔住時用講的 ----
// 中文與印尼語（看護模式）都聽得懂；norm() 會去掉空白，所以印尼語片語不寫空白。順序有意義：「找不到電梯」先於「到了」。
export type TripCommand = "help" | "speak" | "next" | "bigger" | "smaller";
export function parseTripVoice(text: string): TripCommand | null {
  const t = norm(text).toLowerCase();
  if (/(找不到|電梯在哪|幫忙|幫我|救命|求助|tolong|bantu|tidakketemu|liftdimana)/.test(t)) return "help";
  if (/(念|唸|讀|再說一次|說一次|baca|ulang)/.test(t)) return "speak";
  if (/(縮小|小一點|kecilkan|lebihkecil)/.test(t)) return "smaller";
  if (/(放大|大一點|看不清楚|besarkan|lebihbesar)/.test(t)) return "bigger";
  if (/(下一步|下一個|到.{0,6}了|換好|出站|好了|繼續|ok|lanjut|berikut|sudah|sampai)/.test(t)) return "next";
  return null;
}
