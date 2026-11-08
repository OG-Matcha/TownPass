// 給耳朵聽的逐步導引：和 TripView 的卡片 1:1，但不是把螢幕文字照念。
// 規則：動作先講、短句、不念符號、數字用口語、電梯正常就不提。
// 印尼語結構相同；站名、出口編號維持中文（現場指標是中文）。翻譯尚未經母語者校對。
import { LINE_NAME } from "./route.ts";
import { carsId, doorId, lineId } from "./i18n.ts";
import type { Step } from "./planner.ts";
import type { StationStatus } from "./station.ts";

export type Spoken = { short: string; detail: string | null };

const MAX_ZH = 40;
const len = (s: string) => [...s].length;
/** 顯示用短站名（同 planner.short；這裡自己寫一份，避免載入 planner 的狀態）。 */
const sh = (s: string) => (s.endsWith("車站") ? s : s.replace(/站$/, "")).replace(/[/／]/g, "").replace(/\d+/g, (m) => zhNum(+m));

const D = "零一二三四五六七八九";
/** 口語數字：12 → 十二、23 → 二十三。 */
export function zhNum(n: number): string {
  if (n < 10) return D[n];
  if (n < 20) return "十" + (n % 10 ? D[n % 10] : "");
  if (n < 100) return D[Math.floor(n / 10)] + "十" + (n % 10 ? D[n % 10] : "");
  return String(n).replace(/\d/g, (c) => D[+c]);
}
/** 自由文字裡的阿拉伯數字換成口語。 */
const digitsZh = (s: string) => s.replace(/\d+/g, (m) => zhNum(+m));
/** 數量：2 說「兩」。 */
const count = (n: number) => (n === 2 ? "兩" : zhNum(n));

// ---- 出口 ----
type Exit = { exit: string; kind: string };
/** 「出口3」→「三號出口」；「M2」→「M二號出口」；「單一出口」→「唯一的出口」。 */
function exitZh(code: string): string {
  if (/單一/.test(code)) return "唯一的出口";
  const m = code.match(/^出口\s*(\d+)([A-Za-z]?)$/);
  if (m) return `${zhNum(+m[1])}${m[2]}號出口`;
  const m2 = code.match(/^([A-Za-z]+)(\d+)$/);
  if (m2) return `${m2[1]}${zhNum(+m2[2])}號出口`;
  return digitsZh(code.replace(/\s/g, ""));
}
const exitId = (code: string) => (/單一/.test(code) ? "satu-satunya pintu" : `Pintu ${code.replace(/^出口\s*/, "").replace(/號?出口$/, "")}`);

/** 優先用沒有在保養的電梯出口，其次坡道。 */
function pickExits(st: StationStatus, n: number): Exit[] {
  const busy = new Set(st.dayExitWork.map((m) => m.place));
  const all = [...st.entrances].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "elevator" ? -1 : 1));
  const ok = all.filter((e) => !busy.has(e.exit));
  const pool = ok.length ? ok : all;
  // 同一種方式才合併（電梯加坡道只講第一種）
  return pool.filter((e) => e.kind === pool[0]?.kind).slice(0, n);
}

/** 只講一個出口：「從芝山站二號出口搭電梯進站」。stepsOf 已把最近、最好的出口排第一。 */
function exitSentenceZh(st: StationStatus, verb: "進站" | "出站", _n = 1): string {
  const e = pickExits(st, 1)[0];
  if (!e) return `${digitsZh(st.station)}${verb}`;
  return `從${digitsZh(st.station)}${exitZh(e.exit)}${e.kind === "ramp" ? "走坡道" : "搭電梯"}${verb}`;
}
/** 其他出口（放 detail）：「也可以走一號出口」。 */
function exitAltZh(st: StationStatus): string | null {
  const ex = pickExits(st, 3);
  if (ex.length < 2 || /單一/.test(ex[0].exit)) return null;
  return `也可以走${ex.slice(1).map((e) => exitZh(e.exit)).join("或")}`;
}
function exitSentenceId(st: StationStatus, verb: "masuk" | "keluar"): string {
  const e = pickExits(st, 1)[0];
  const V = verb === "masuk" ? "Masuk" : "Keluar";
  if (!e) return `${V} stasiun`;
  return `${V} lewat ${exitId(e.exit)} ${st.station} ${e.kind === "ramp" ? "dengan jalur landai" : "dengan lift"}`;
}

// ---- 電梯狀況：只有有問題才講 ----
function warnZh(st: StationStatus | null | undefined, who: string): string | null {
  if (!st) return null;
  if (st.blocked) return `注意，${who}所有出口電梯白天都在保養`;
  const exit = st.dayExitWork.length > 0;
  const plat = st.dayPlatformWork.length > 0;
  if (exit && plat) return `注意，${who}有出口和月臺電梯在保養`;
  if (exit) return `注意，${who}有出口電梯在保養`;
  if (plat) return `注意，${who}有月臺電梯在保養`;
  if (st.anomalies.length) return `注意，${who}有電梯公告異常`;
  return null;
}
function warnId(st: StationStatus | null | undefined, at: string | null): string | null {
  if (!st) return null;
  const a = at ? ` di ${at}` : "";
  if (st.blocked) return `Perhatian, semua lift pintu keluar${a} dirawat siang ini`;
  const exit = st.dayExitWork.length > 0;
  const plat = st.dayPlatformWork.length > 0;
  if (exit && plat) return `Perhatian, lift pintu keluar dan lift peron${a} sedang dirawat`;
  if (exit) return `Perhatian, ada lift pintu keluar${a} yang sedang dirawat`;
  if (plat) return `Perhatian, ada lift peron${a} yang sedang dirawat`;
  if (st.anomalies.length) return `Perhatian, ada pengumuman lift rusak${a}`;
  return null;
}

// ---- 動線（detail）----
const cleanPath = (p: string) => p.replace(/[（(][^）)]*[）)]/g, "");
type Words = {
  elev: (n: string) => string;
  gate: (pre: string) => string;
  toPlatform: string;
  again: string;
  walkOut: string;
  leave: string;
};
const PW: Record<"zh" | "id", Words> = {
  zh: {
    elev: (n) => `搭${n}`,
    gate: (pre) => (pre ? `到${digitsZh(pre)}，過無障礙閘門` : "過無障礙閘門"),
    toPlatform: "到月臺",
    again: "再",
    walkOut: "走到出口",
    leave: "出站",
  },
  id: {
    elev: (n) => `naik ${n.includes("出口") ? "lift pintu keluar" : n.includes("月") ? "lift peron" : "lift"}`,
    gate: (pre) => (pre ? `ke ${pre.includes("大廳") ? "lobi" : "lantai atas"}, lewati gerbang tiket aksesibel` : "lewati gerbang tiket aksesibel"),
    toPlatform: " sampai di peron",
    again: "lalu ",
    walkOut: "jalan ke pintu keluar",
    leave: " sampai di luar stasiun",
  },
};
/** 「出口電梯--大廳無障礙閘門--月臺電梯--月臺」→「搭出口電梯，過無障礙閘門，再搭月臺電梯到月臺」。出站反過來。 */
function pathSpoken(path: string, exit: boolean, lang: "zh" | "id"): string | null {
  const w = PW[lang];
  let nodes = cleanPath(path).split(/-{1,2}/).map((x) => x.trim()).filter(Boolean);
  if (exit) nodes.reverse();
  if (exit && nodes.length && /^月[臺台]$/.test(nodes[0])) nodes = nodes.slice(1);
  if (!exit && nodes.length && /^出口$/.test(nodes[0])) nodes = nodes.slice(1);
  const out: string[] = [];
  let seenElev = false;
  nodes.forEach((n, i) => {
    const last = i === nodes.length - 1;
    if (/^月[臺台]$/.test(n)) {
      if (last && !exit) out.length ? (out[out.length - 1] += w.toPlatform) : out.push(w.toPlatform.trim());
      return;
    }
    if (/^出口$/.test(n)) return void out.push(w.walkOut);
    if (n.includes("閘門")) return void out.push(w.gate(n.replace(/無障礙閘門.*/, "")));
    if (n.includes("電梯")) {
      let c = w.elev(n);
      if (exit && last && n.includes("出口")) c += w.leave;
      out.push((seenElev ? w.again : "") + c);
      seenElev = true;
      return;
    }
    out.push(lang === "zh" ? `經過${digitsZh(n)}` : `lewati ${n}`);
  });
  if (!out.length) return null;
  if (lang === "zh") return `${exit ? "從月臺" : "進站後"}${out.join("，")}`;
  return `${exit ? "Dari peron" : "Setelah masuk"}, ${out.join(", ")}`;
}

// ---- 車廂、車門 ----
function carsZh(cars: string | null): string | null {
  if (!cars) return null;
  const n = (cars.split("【")[0].match(/\d+/g) ?? []).slice(0, 2).map(Number);
  if (!n.length) return null;
  return n.length === 1 ? `第${zhNum(n[0])}節車廂` : `第${zhNum(n[0])}或第${zhNum(n[1])}節車廂`;
}
function doorZh(door: string | null): string | null {
  if (!door) return null;
  if (door === "左側開門") return "到站時左邊開門";
  if (door === "右側開門") return "到站時右邊開門";
  if (door.includes("兩側")) return "到站時左右兩邊的門都可能開";
  return null;
}
function carsIdShort(cars: string | null): string | null {
  if (!cars) return null;
  const n = (cars.split("【")[0].match(/\d+/g) ?? []).slice(0, 2);
  return n.length ? carsId(n.map((x) => `第${x}節`).join("、") + "車廂") : null;
}

const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).map((x) => `${x}。`).join("");
const tailOf = (r: Ride) => `坐${count(r.stops)}站到${sh(r.to)}`;

type Ride = Extract<Step, { kind: "ride" }>;
type Enter = Extract<Step, { kind: "enter" | "exit" }>;

/** 在字數預算內排搭乘句；放不下的車門、車廂移到 spill（進 detail）。 */
function rideZh(r: Ride, budget: number): { text: string; spill: string[] } {
  const head = `搭往${sh(r.toward)}的車`;
  const tail = tailOf(r);
  const spill: string[] = [];
  let c = carsZh(r.cars);
  let d = doorZh(r.door);
  const build = () => [head, c, tail, d].filter(Boolean).join("，");
  if (len(build()) + 1 > budget && d) {
    spill.push(d);
    d = null;
  }
  if (len(build()) + 1 > budget && c) {
    spill.unshift(`輪椅請停靠在${c}`);
    c = null;
  }
  return { text: len(build()) + 1 > budget ? tail : build(), spill };
}

export function spokenCards(steps: Step[], date: string, lang: "zh" | "id"): Spoken[] {
  void date; // 電梯狀態已由 stepsOf 依出發日放進 steps；保留參數和 TripView 對齊
  const zh = lang === "zh";
  const out: Spoken[] = [];
  steps.forEach((s, i) => {
    if (s.kind === "enter") return; // 和下一張搭乘合成一張
    if (s.kind === "ride") {
      const prev = steps[i - 1];
      const first = prev?.kind === "enter" ? (prev as Enter) : null; // 路上換路線後從月臺出發：沒有進站
      const next = steps[i + 1];
      const arrive = next && "st" in next ? next.st : null; // 到站那一站的狀態（同 TripView 的 status(s.to)）
      if (zh) {
        const spill: string[] = [];
        let a: string | null = null;
        let w: string | null = first ? warnZh(first.st, "這站") : warnZh(arrive, sh(s.to));
        const must = len(tailOf(s)) + 1;
        if (first) {
          for (const n of [2, 1]) {
            a = exitSentenceZh(first.st, "進站", n);
            if (len(a) + 1 + (w ? len(w) + 1 : 0) + must <= MAX_ZH) break;
          }
        }
        const used = () => (a ? len(a) + 1 : 0) + (w ? len(w!) + 1 : 0);
        if (w && used() + must > MAX_ZH) {
          spill.push(w);
          w = null;
        }
        const r = rideZh(s, MAX_ZH - used());
        const path = first?.fac?.path ? pathSpoken(first.fac.path, false, "zh") : null;
        const detail = [path, first ? exitAltZh(first.st) : null, ...r.spill, ...spill].filter(Boolean).join("。");
        out.push({ short: first ? join([a, w, r.text]) : join([r.text, w]), detail: detail ? detail + "。" : null });
      } else {
        const a = first ? exitSentenceId(first.st, "masuk") : null;
        const w = first ? warnId(first.st, null) : warnId(arrive, sh(s.to));
        const cars = carsIdShort(s.cars);
        const door = s.door ? doorId(s.door) : null;
        const ride = `Naik kereta arah ${sh(s.toward)}${cars ? `, ${cars}` : ""}, turun setelah ${s.stops} stasiun di ${sh(s.to)}${door ? `, ${door}` : ""}`;
        const path = first?.fac?.path ? pathSpoken(first.fac.path, false, "id") : null;
        out.push({ short: (first ? join([a, w, ride]) : join([ride, w])).replace(/\.?。/g, ". ").trim(), detail: path ? path + "." : null });
      }
    } else if (s.kind === "transfer") {
      if (zh) {
        const a = s.sameLine ? `在${sh(s.station)}下車，換搭支線的車` : `在${sh(s.station)}換${LINE_NAME[s.to]}`;
        const w = warnZh(s.st, "這站");
        const hint = "跟著無障礙標誌找電梯";
        const full = join([a, w, hint]);
        const shortText = len(full) <= MAX_ZH ? full : join([a, w]);
        const help = "找不到電梯時，可以按電梯旁的對講機，或問詢問處。";
        out.push({ short: shortText, detail: (shortText === full ? "" : hint + "。") + help });
      } else {
        const a = s.sameLine ? `Turun di ${sh(s.station)}, lalu naik kereta cabang` : `Di ${sh(s.station)} pindah ke ${lineId(s.to)}`;
        out.push({
          short: join([a, warnId(s.st, null), "Ikuti tanda aksesibel menuju lift"]).replace(/。/g, ". ").trim(),
          detail: "Kalau tidak ketemu lift, tekan interkom di samping lift atau tanya bagian informasi.",
        });
      }
    } else if (s.kind === "exit") {
      if (zh) {
        const w = warnZh(s.st, "這站");
        let a = "";
        for (const n of [2, 1]) {
          a = exitSentenceZh(s.st, "出站", n);
          if (len(join([a, w])) <= MAX_ZH) break;
        }
        const path = s.fac?.path ? pathSpoken(s.fac.path, true, "zh") : null;
        const alt = s.alt ? `可以改從${sh(s.alt.station)}出站，直線約${digitsZh(String(s.alt.meters))}公尺` : null;
        const detail = [path, exitAltZh(s.st), alt].filter(Boolean).join("。");
        out.push({ short: join([a, w]), detail: detail ? detail + "。" : null });
      } else {
        const path = s.fac?.path ? pathSpoken(s.fac.path, true, "id") : null;
        const alt = s.alt ? `Bisa juga keluar lewat ${sh(s.alt.station)}, sekitar ${s.alt.meters} meter` : null;
        const detail = [path, alt].filter(Boolean).join(". ");
        out.push({
          short: join([exitSentenceId(s.st, "keluar"), warnId(s.st, null)]).replace(/。/g, ". ").trim(),
          detail: detail ? detail + "." : null,
        });
      }
    }
  });
  return out;
}

/** 路上「電梯不能用」換路線後念的一句：≤ 40 字、不念符號。 */
export type RerouteSay =
  | { kind: "exit"; exit: string; ramp: boolean; enter: boolean }
  | { kind: "origin"; station: string }
  | { kind: "dest"; station: string }
  | { kind: "transfer"; via: string[]; dest: string };
export function rerouteSpoken(c: RerouteSay, lang: "zh" | "id"): string {
  if (lang === "id") {
    if (c.kind === "exit") return `Baik, ${c.enter ? "masuk" : "keluar"} lewat ${exitId(c.exit)} ${c.ramp ? "dengan jalur landai" : "dengan lift"}.`;
    if (c.kind === "origin") return `Baik, ganti rute, masuk dari ${sh(c.station)}.`;
    if (c.kind === "dest") return `Baik, ganti rute, keluar di ${sh(c.station)}.`;
    return c.via.length ? `Baik, ganti rute, pindah kereta di ${sh(c.via[0])}.` : `Baik, ganti rute, langsung ke ${sh(c.dest)}.`;
  }
  if (c.kind === "exit") return `好，改從${exitZh(c.exit)}${c.ramp ? "走坡道" : "搭電梯"}${c.enter ? "進站" : "出站"}。`;
  if (c.kind === "origin") return `好，換一條路，改從${sh(c.station)}進站。`;
  if (c.kind === "dest") return `好，換一條路，改到${sh(c.station)}出站。`;
  return c.via.length ? `好，換一條路，改在${sh(c.via[0])}轉乘。` : `好，換一條路，不用轉乘，直接坐到${sh(c.dest)}。`;
}
