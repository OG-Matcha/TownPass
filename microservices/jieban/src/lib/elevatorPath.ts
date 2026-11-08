// 電梯動線示意圖的資料整理：把開放資料的動線字串（例：「出口電梯--大廳無障礙閘門--月臺電梯--月臺」）
// 拆成節點。只用資料裡有的字，不補沒有的設施。
export type NodeKind = "ground" | "elevator" | "gate" | "platform";
export type PathNode = { kind: NodeKind; label: string; level: string; note?: string };

/** 「第1節、第4節車廂」→ [1,4] */
export function carNumbers(cars: string | null | undefined): number[] {
  if (!cars) return [];
  return [...new Set([...cars.matchAll(/\d+/g)].map((m) => +m[0]))].filter((n) => n > 0 && n < 20).sort((a, b) => a - b);
}

/** 依空間順序（地面在上、月臺在下）回傳節點；出站時由呼叫端反向走。 */
export function parsePath(path: string | null | undefined): PathNode[] {
  if (!path) return [];
  const out: PathNode[] = [];
  for (const raw of path.split(/-{1,2}/).map((x) => x.trim()).filter(Boolean)) {
    const note = raw.match(/[（(]([^）)]*)[）)]/)?.[1];
    const seg = raw.replace(/[（(][^）)]*[）)]/g, "").trim();
    if (!seg) continue;
    let n: PathNode;
    if (/閘門/.test(seg)) {
      const lv = seg.replace(/無障礙閘門$/, "").replace(/閘門$/, "");
      n = { kind: "gate", label: "無障礙閘門", level: lv || "大廳" };
    } else if (/^月臺$|^月台$/.test(seg)) n = { kind: "platform", label: "月臺", level: "月臺" };
    else if (/月[臺台]電梯/.test(seg)) n = { kind: "elevator", label: "月臺電梯", level: "往月臺" };
    else if (/電梯/.test(seg)) n = { kind: "elevator", label: seg.replace(/^出口電梯$/, "出口電梯"), level: /出口/.test(seg) ? "地面" : "換層" };
    else if (/^出口/.test(seg)) n = { kind: "ground", label: seg, level: "地面" };
    else n = { kind: "ground", label: seg, level: "" };
    if (note) n.note = note;
    out.push(n);
  }
  // 出口電梯：地面和電梯是同一個點，電梯節點掛地面層級
  return out;
}

/** 完整唸出來的句子（也當 aria-label）。 */
export function pathSentence(opts: {
  nodes: PathNode[];
  leaving: boolean;
  station?: string;
  exitName?: string;
  gate?: string | null;
  cars?: string | null;
  door?: string | null;
}): string {
  const { nodes, leaving, station, exitName, gate, cars, door } = opts;
  const seq = leaving ? [...nodes].reverse() : nodes;
  const parts = seq.map((n) => {
    if (n.kind === "gate") return `過無障礙閘門${gate ? `，在${gate}` : ""}`;
    if (n.kind === "platform") return leaving ? "從月臺出發" : "到月臺";
    if (n.kind === "elevator") return `搭${n.label}`;
    return exitName ? `從${exitName}` : n.label;
  });
  const head = `示意圖：${station ? station + "，" : ""}${leaving ? "出站" : "進站"}動線。`;
  const body = parts.filter(Boolean).join("，再") + "。";
  const tail = (!leaving && cars ? `輪椅停靠${cars}。` : "") + (door ? `${door}。` : "");
  return head + body + tail;
}
