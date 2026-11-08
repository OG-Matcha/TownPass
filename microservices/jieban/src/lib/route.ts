// 捷運路線規劃：站間行駛時間（官方開放資料）＋轉乘步行時間，Dijkstra 找最省時路線。
// 只做到「站與出口」層級；站內走法沒有開放資料，不做。

export type Line = "R" | "BR" | "BL" | "G" | "O" | "Y";
export type Edge = { line: Line; a: string; b: string; sec: number };
export type Network = { items: Edge[]; transferMin: Record<string, number> };

export const LINE_NAME: Record<Line, string> = {
  R: "淡水信義線",
  BR: "文湖線",
  BL: "板南線",
  G: "松山新店線",
  O: "中和新蘆線",
  Y: "環狀線",
};

export type Leg = { line: Line; from: string; to: string; stops: number; sec: number; via: string[] };
export type Transfer = { station: string; from: Line; to: Line; walkMin: number };
export type Plan = { legs: Leg[]; transfers: Transfer[]; totalMin: number };

const DEFAULT_TRANSFER_MIN = 3; // 轉乘步行時間資料只有 21 站，其他用 3 分鐘
const TRANSFER_WAIT_SEC = 180; // 轉乘後候車，估計值

type Node = string; // `${line}|${station}`
const node = (line: Line, station: string): Node => `${line}|${station}`;
const parse = (n: Node) => {
  const i = n.indexOf("|");
  return { line: n.slice(0, i) as Line, station: n.slice(i + 1) };
};

// 支線與分支：同一條線，但實際要在交會站換車
const BRANCHES: { line: Line; junction: string; sides: string[][] }[] = [
  { line: "R", junction: "北投站", sides: [["新北投站"]] },
  { line: "G", junction: "七張站", sides: [["小碧潭站"]] },
  {
    line: "O",
    junction: "大橋頭站",
    sides: [
      ["三重國小站", "三和國中站", "徐匯中學站", "三民高中站", "蘆洲站"],
      ["台北橋站", "菜寮站", "三重站", "先嗇宮站", "頭前庄站", "新莊站", "輔大站", "丹鳳站", "迴龍站"],
    ],
  },
];

/** 一段同線行程若需要在交會站換車（支線↔主線、或兩個分支之間），拆成兩段並記一次換車。 */
function splitBranches(legs: Leg[], transfers: Transfer[]): number {
  let extraSec = 0;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const br = BRANCHES.find((b) => b.line === leg.line);
    if (!br) continue;
    const stations = [leg.from, ...leg.via];
    // 每站屬於哪一側：分支編號 0、1…；不在任何分支（主線或共用段）為 -1；交會站不算
    const sides = new Set(
      stations.filter((s) => s !== br.junction).map((s) => br.sides.findIndex((side) => side.includes(s))),
    );
    const needSplit = br.sides.length === 1 ? sides.has(0) && sides.has(-1) : sides.has(0) && sides.has(1);
    const jIdx = stations.indexOf(br.junction);
    if (!needSplit || jIdx <= 0 || jIdx >= stations.length - 1) continue;
    const firstSec = Math.round((leg.sec * jIdx) / (stations.length - 1));
    const first: Leg = { line: leg.line, from: leg.from, to: br.junction, stops: jIdx, sec: firstSec, via: stations.slice(1, jIdx + 1) };
    const second: Leg = { line: leg.line, from: br.junction, to: leg.to, stops: stations.length - 1 - jIdx, sec: leg.sec - firstSec, via: stations.slice(jIdx + 1) };
    legs.splice(i, 1, first, second);
    transfers.push({ station: br.junction, from: leg.line, to: leg.line, walkMin: 0 });
    extraSec += TRANSFER_WAIT_SEC;
    i++;
  }
  return extraSec;
}

export function stationsOf(net: Network): string[] {
  return [...new Set(net.items.flatMap((e) => [e.a, e.b]))].sort((x, y) => x.localeCompare(y, "zh-Hant"));
}

/**
 * walkFactor：行動不便時轉乘步行時間的倍數（估計值，畫面要標示）。
 */
/** transferPenaltySec：只影響選路（每轉乘一次多算的成本，用來找「少轉乘」方案），不算進顯示的時間。 */
const AVOID_SEC = 3600; // 「避開某轉乘站」：多算 1 小時，有別的路就會改走

/** startLine：已經在站內某條線的月臺上（路上換路線用），只從這條線出發。 */
export function planRoute(net: Network, origin: string, dest: string, walkFactor = 1, transferPenaltySec = 0, avoidTransferAt: ReadonlySet<string> = new Set(), startLine: Line | null = null): Plan | null {
  const penaltyAt = (s: string) => transferPenaltySec + (avoidTransferAt.has(s) ? AVOID_SEC : 0);
  if (origin === dest) return null;
  const adj = new Map<Node, { to: Node; sec: number; transfer: boolean }[]>();
  const add = (from: Node, to: Node, sec: number, transfer = false) => {
    if (!adj.has(from)) adj.set(from, []);
    adj.get(from)!.push({ to, sec, transfer });
  };
  const linesAt = new Map<string, Set<Line>>();
  for (const e of net.items) {
    add(node(e.line, e.a), node(e.line, e.b), e.sec);
    add(node(e.line, e.b), node(e.line, e.a), e.sec);
    for (const s of [e.a, e.b]) {
      if (!linesAt.has(s)) linesAt.set(s, new Set());
      linesAt.get(s)!.add(e.line);
    }
  }
  for (const [s, lines] of linesAt) {
    const walk = (net.transferMin[s] ?? DEFAULT_TRANSFER_MIN) * 60 * walkFactor + TRANSFER_WAIT_SEC;
    for (const l1 of lines) for (const l2 of lines) if (l1 !== l2) add(node(l1, s), node(l2, s), walk + penaltyAt(s), true);
  }

  const starts = [...(linesAt.get(origin) ?? [])].filter((l) => !startLine || l === startLine).map((l) => node(l, origin));
  if (!starts.length || !linesAt.has(dest)) return null;

  // 節點只有約 140 個，用簡單陣列版 Dijkstra 就夠
  const dist = new Map<Node, number>(starts.map((s) => [s, 0]));
  const prev = new Map<Node, Node>();
  const done = new Set<Node>();
  let end: Node | null = null;
  while (true) {
    let cur: Node | null = null;
    for (const [n, d] of dist) if (!done.has(n) && (cur === null || d < dist.get(cur)!)) cur = n;
    if (cur === null) break;
    done.add(cur);
    if (parse(cur).station === dest) {
      end = cur;
      break;
    }
    for (const { to, sec } of adj.get(cur) ?? []) {
      const nd = dist.get(cur)! + sec;
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd);
        prev.set(to, cur);
      }
    }
  }
  if (!end) return null;

  const path: Node[] = [];
  for (let n: Node | undefined = end; n; n = prev.get(n)) path.unshift(n);

  const legs: Leg[] = [];
  const transfers: Transfer[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = parse(path[i - 1]);
    const b = parse(path[i]);
    const sec = dist.get(path[i])! - dist.get(path[i - 1])!;
    if (a.line !== b.line) {
      transfers.push({
        station: a.station,
        from: a.line,
        to: b.line,
        walkMin: Math.round((net.transferMin[a.station] ?? DEFAULT_TRANSFER_MIN) * walkFactor),
      });
      continue;
    }
    const last = legs[legs.length - 1];
    if (last && last.line === a.line && last.to === a.station) {
      last.to = b.station;
      last.stops += 1;
      last.sec += sec;
      last.via.push(b.station);
    } else {
      legs.push({ line: a.line, from: a.station, to: b.station, stops: 1, sec, via: [b.station] });
    }
  }
  const extra = splitBranches(legs, transfers);
  return { legs, transfers, totalMin: Math.round((dist.get(end)! - transfers.reduce((n, t) => n + penaltyAt(t.station), 0) + extra) / 60) };
}
