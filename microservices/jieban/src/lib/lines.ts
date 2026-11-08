// 路線站序與行車方向：選站頁依路線分組、到站開門側只顯示這班車的方向。
import type { Edge, Leg, Line, Network } from "./route.ts";

function adjacency(edges: Edge[], line: Line) {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.line !== line) continue;
    for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) {
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    }
  }
  return adj;
}

function bfs(adj: Map<string, Set<string>>, start: string) {
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  let last = start;
  while (queue.length) {
    const cur = queue.shift()!;
    last = cur;
    for (const n of adj.get(cur) ?? []) if (!prev.has(n)) (prev.set(n, cur), queue.push(n));
  }
  return { prev, last };
}

/** 每條線的站序：主線（最長的一段）由一端到另一端，支線接在後面。 */
export function lineStations(net: Network): Record<Line, string[]> {
  const lines = [...new Set(net.items.map((e) => e.line))];
  const out = {} as Record<Line, string[]>;
  for (const line of lines) {
    const adj = adjacency(net.items, line);
    const any = adj.keys().next().value!;
    const a = bfs(adj, any).last; // 離任一點最遠 = 一端
    const { prev, last: b } = bfs(adj, a); // 離 a 最遠 = 另一端
    const main: string[] = [];
    for (let s: string | null | undefined = b; s; s = prev.get(s)) main.unshift(s);
    const rest = [...adj.keys()].filter((s) => !main.includes(s));
    out[line] = [...main, ...rest];
  }
  return out;
}

/** 這班車往前還會到哪些站（含支線），用來判斷「往 X」是不是這個方向。 */
export function stationsAhead(net: Network, leg: Leg): Set<string> {
  const adj = adjacency(net.items, leg.line);
  const before = leg.via.length > 1 ? leg.via[leg.via.length - 2] : leg.from;
  const seen = new Set<string>([before, leg.to]);
  const queue = [leg.to];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
  }
  seen.delete(before);
  seen.delete(leg.to);
  return seen;
}

/**
 * 資料原文例：「往松山-左側開門，往新店-右側開門」「左側開門」「左側開門，右側開門」。
 * 只回傳這班車方向的那一側；判斷不出來就回傳原文。
 */
export function doorForDirection(raw: string | null, ahead: Set<string>): string | null {
  if (!raw) return null;
  const parts = raw.split(/[，。]/).map((p) => p.trim()).filter(Boolean);
  const directed = parts
    .map((p) => p.match(/^往(.+?)-(.側開門)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ to: m[1].split("、"), side: m[2] }));
  if (!directed.length) {
    const sides = [...new Set(raw.match(/[左右]側/g) ?? [])];
    return sides.length > 1 ? "左右兩側都可能開門，依月臺而定" : raw;
  }
  const hit = directed.find((d) => d.to.some((t) => ahead.has(`${t}站`)));
  return hit ? hit.side : raw;
}

/** 這班車的「往 X 方向」：行車方向上的端點站（主線端點優先，其次支線端點）。 */
export function towardTerminal(net: Network, leg: Leg, ahead: Set<string>): string {
  const adj = adjacency(net.items, leg.line);
  const ends = [...adj.entries()].filter(([, n]) => n.size === 1).map(([s]) => s);
  const seq = lineStations(net)[leg.line];
  const mainEnds = [seq[0], ...seq.filter((s, i) => i > 0 && adj.get(seq[i - 1])?.has(s)).slice(-1)];
  const hit = mainEnds.find((s) => ahead.has(s)) ?? ends.find((s) => ahead.has(s));
  return hit ?? leg.to;
}
