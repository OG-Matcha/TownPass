// 把建置好的網頁打包進城市通 App：dist/ → <App>/assets/web/mrt/，並在 pubspec.yaml 列出每個資料夾
// （Flutter 的 assets 不會遞迴子資料夾）。App 用 InAppLocalhostServer 提供 http://localhost:8080/mrt/index.html。
// 用法：npm run build && node scripts/sync-app.mjs [App 目錄，預設 ../../team-repo]
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const app = resolve(process.argv[2] ?? "../../team-repo");
const dist = resolve("dist");
const target = join(app, "assets", "web", "mrt");
rmSync(target, { recursive: true, force: true });
// App 裡的向量改由 App 的 `embed` handler 提供（EmbeddingGemma 2，與「找服務」共用同一顆），
// 網頁自己的 e5 模型（models/）與它的 WASM 執行環境（ort/）只留給一般瀏覽器部署，不打包進 App（省約 140 MB）。
// 要暫時打包回去（例如測舊版 App）：APP_E5=1 node scripts/sync-app.mjs
const SKIP_TOP = process.env.APP_E5 === "1" ? new Set() : new Set(["models", "ort"]);
// fs.cpSync 在這台 Windows 的 Node 22 會 segfault，自己遞迴複製
(function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(from)) {
    if (from === dist && SKIP_TOP.has(f)) continue;
    const a = join(from, f), b = join(to, f);
    if (statSync(a).isDirectory()) copy(a, b);
    else copyFileSync(a, b);
  }
})(dist, target);

const dirs = [];
(function walk(d) {
  dirs.push(d);
  for (const f of readdirSync(d)) if (statSync(join(d, f)).isDirectory()) walk(join(d, f));
})(join(app, "assets", "web"));
const lines = dirs.map((d) => `    - ${relative(app, d).replaceAll("\\", "/")}/`);

const pub = join(app, "pubspec.yaml");
const raw = readFileSync(pub, "utf8");
const eol = raw.includes("\r\n") ? "\r\n" : "\n";
const BEGIN = "    # >>> web assets (scripts/sync-app.mjs 產生，勿手改)";
const END = "    # <<< web assets";
let s = raw.replace(/\r\n/g, "\n");
const block = [BEGIN, ...lines, END].join("\n");
// 用字串位置取代，不用 RegExp：BEGIN 裡的括號會被當成群組，整段永遠比對不到，新資料夾（models/、ort/）就不會被列進 pubspec
if (s.includes(BEGIN)) {
  const i = s.indexOf(BEGIN);
  const j = s.indexOf(END, i);
  if (j < 0) throw new Error("pubspec.yaml 有開頭標記卻沒有結尾標記");
  s = s.slice(0, i) + block + s.slice(j + END.length);
}
else s = s.replace("    - assets/svg/\n", `    - assets/svg/\n${block}\n`);
if (!s.includes(BEGIN)) throw new Error("pubspec.yaml 找不到 assets/svg/，無法插入");
writeFileSync(pub, s.replace(/\n/g, eol));
console.log(`已複製到 ${target}，pubspec 列出 ${lines.length} 個資料夾`);
