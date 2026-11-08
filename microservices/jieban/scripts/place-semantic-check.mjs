// 目的地理解・整條管線（規則＋裝置端語意）在瀏覽器裡檢查：離線（封鎖非 localhost 請求）、開發集／盲測集前 3 命中率、延遲。
// 用法：node scripts/place-semantic-check.mjs [測試集.json ...]   （自己起 vite 於 5183）
// 測試集格式同 place-search-check.mts：[["輸入", 類型, 期望, 來源層], ...]
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 5183;
const ORIGIN = `http://localhost:${PORT}`;
const files = process.argv.slice(2).length ? process.argv.slice(2) : ["scripts/place-dev.json", "scripts/place-blind.json"].filter((f) => existsSync(f));

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { shell: true, stdio: "ignore" });
const killVite = () => {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: "ignore" });
    else vite.kill("SIGTERM");
  } catch {}
};
process.on("exit", killVite);
async function waitServer() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(ORIGIN + "/favicon.svg")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("vite did not start");
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "-");

let code = 0;
try {
  await waitServer();
  const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const ctx = await browser.newContext();
  let blocked = 0;
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.protocol === "data:" || u.protocol === "blob:") {
      if (u.pathname === "/__blank.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>x</title>" });
      return route.continue();
    }
    blocked++; return route.abort();
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  await page.goto(ORIGIN + "/__blank.html");

  const load = await page.evaluate(async () => {
    const t0 = performance.now();
    const planner = await import("/src/lib/planner.ts");
    const places = await import("/src/lib/places.ts");
    const ps = await import("/src/lib/placeSearch.ts");
    await Promise.all([planner.loadData(), places.loadPlaces()]);
    window.__ps = ps;
    ps.warmPlaceSearch();
    for (let i = 0; i < 600 && !ps.placeSemanticReady(); i++) await new Promise((r) => setTimeout(r, 500));
    const catMs = performance.now() - t0;
    for (let i = 0; i < 1200 && !ps.placePoiSemanticReady(); i++) await new Promise((r) => setTimeout(r, 500));
    return { ms: performance.now() - t0, catMs, ready: ps.placeSemanticReady(), poiReady: ps.placePoiSemanticReady(), entrances: planner.entrances.value.length, stations: planner.stations.value.length, places: places.places.value.length };
  });
  console.log("載入＋語意索引：分類句 %s ms、含地點名 %s ms；語意可用 %s／地點名 %s；車站 %d、出入口 %d、場館 %d；封鎖外部請求 %d 次", f1(load.catMs), f1(load.ms), load.ready, load.poiReady, load.stations, load.entrances, load.places, blocked);
  if (!load.ready) throw new Error("semantic index not ready (model missing? run npm run fetch:model)");

  const run = (cases) => page.evaluate(async (cases) => {
    const out = [];
    for (const [t] of cases) {
      const t0 = performance.now();
      const hits = await window.__ps.searchPlaces(t, { limit: 3 });
      out.push({ ms: performance.now() - t0, hits: hits.map((h) => ({ type: h.type, name: h.name, fullName: h.fullName ?? null, station: h.station, why: h.why, score: h.score, category: h.category ?? null, sub: h.sub })) });
    }
    return out;
  }, cases);

  for (const f of files) {
    // 盲測集格式 {q, accept, type} → [q, type, want, why]；accept 可寫站名、地點名、「類別:醫院」，任一符合即可
    const n2 = (x) => String(x).replaceAll("臺", "台").replace(/\s/g, "");
    const cases = JSON.parse(readFileSync(f, "utf8")).map((x) => (Array.isArray(x) ? x : [x.q, x.accept.length ? "any" : "none", x.accept.join("|"), x.type === "describe" ? "semantic" : x.type]));
    await run(cases.slice(0, 2)); // 暖機
    const res = await run(cases);
    const byType = {};
    const byWhy = {};
    const misses = [];
    let ok = 0;
    const semMs = [];
    const ruleMs = [];
    cases.forEach(([text, type, want, why], i) => {
      const r = res[i];
      const names = r.hits.map((h) => (h.type === "station" ? h.station : h.name));
      const has = (w, ty) => r.hits.some((h, j) => (names[j] === w || h.fullName === w) && (!ty || h.type === ty));
      const strs = (h) => (h.type === "station" ? [h.station, h.station.replace(/站$/, "")] : [h.name, h.fullName ?? ""]).filter(Boolean).map(n2);
      let pass;
      if (type === "none") pass = r.hits.length === 0;
      else if (type === "any") pass = want.split("|").some((w) => (w.startsWith("類別:") ? r.hits[0]?.category === w.slice(3) : r.hits.some((h) => strs(h).includes(n2(w)))));
      else if (type === "category") pass = r.hits.length > 0 && r.hits[0].category === want;
      else if (type === "ambiguous") pass = want.split("|").every((w) => has(w));
      else pass = has(want, type);
      if (pass) ok++;
      (r.hits[0]?.why === "semantic" || r.hits.length === 0 ? semMs : ruleMs).push(r.ms);
      for (const [m, k] of [[byType, type], [byWhy, why]]) { m[k] ??= { n: 0, ok: 0 }; m[k].n++; if (pass) m[k].ok++; }
      if (process.env.SHOW_ALL) console.log(`  ${pass ? "ok  " : "MISS"} ${JSON.stringify(text)} → ${r.hits.map((h, j) => `${h.type}:${names[j]}(${h.why} ${h.score.toFixed(2)}${h.category ? " " + h.category : ""})`).join(" | ") || "∅"}`);
      if (!pass) misses.push(`  ${JSON.stringify(text)} 要 ${type}:${want} 得 ${r.hits.map((h, j) => `${h.type}:${names[j]}(${h.why} ${h.score.toFixed(2)}${h.category ? " " + h.category : ""})`).join(" | ") || "∅"}`);
    });
    const acc = ok / cases.length;
    console.log(`\n${f}：${cases.length} 句，前 3 命中 ${ok}（${(acc * 100).toFixed(0)}%）`);
    console.table(Object.entries(byType).map(([k, v]) => ({ 類型: k, n: v.n, 命中: v.ok, 比例: `${((100 * v.ok) / v.n).toFixed(0)}%` })));
    console.table(Object.entries(byWhy).map(([k, v]) => ({ 來源層: k, n: v.n, 命中: v.ok, 比例: `${((100 * v.ok) / v.n).toFixed(0)}%` })));
    console.log("延遲：規則命中 中位 %s ms／P95 %s ms；走到語意 中位 %s ms／P95 %s ms", f1(pct(ruleMs, 0.5)), f1(pct(ruleMs, 0.95)), f1(pct(semMs, 0.5)), f1(pct(semMs, 0.95)));
    if (misses.length) console.log("漏的：\n" + misses.join("\n"));
    if (f.includes("blind") && acc < 0.8) { console.error("FAIL: 盲測前 3 命中 < 80%"); code = 1; }
    if (f.includes("dev") && acc < 0.85) { console.error("FAIL: 開發集前 3 命中 < 85%"); code = 1; }
  }
  await browser.close();
} catch (e) {
  console.error(e); code = 1;
} finally {
  killVite();
}
process.exit(code);
