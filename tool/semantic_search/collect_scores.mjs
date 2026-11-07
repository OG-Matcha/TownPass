// 把 eval_main.dart 印在 logcat 的結果整理成 scores.json。
// 用法：node tool/semantic_search/collect_scores.mjs <logcat 檔> "<裝置說明>"
import { readFileSync, writeFileSync } from "node:fs";

const [log, device = "未註明"] = process.argv.slice(2);
if (!log) throw new Error("用法：collect_scores.mjs <logcat 檔> [裝置說明]");
const out = { meta: {}, variants: {} };
for (const line of readFileSync(log, "utf8").split("\n")) {
  let m;
  if ((m = line.match(/^EVAL_PREPARE (.*)$/))) out.meta.prepare = JSON.parse(m[1]);
  else if ((m = line.match(/^EVAL_VARIANT (.*)$/))) {
    const v = JSON.parse(m[1]);
    out.meta[v.variant] = v;
  } else if ((m = line.match(/^EVAL_Q (.*)$/))) {
    const q = JSON.parse(m[1]);
    (out.variants[q.variant] ??= {})[q.id] = { ms: q.ms, scores: q.scores };
  } else if ((m = line.match(/^EVAL_ERROR (.*)$/))) throw new Error(`量測程式出錯：${m[1]}`);
}
if (!out.meta.prepare || out.meta.prepare.status !== "ready") throw new Error("模型沒有準備好，沒有分數可存");
out.meta.device = device;
out.meta.model = "embeddinggemma-2-text-270m@9be6e8b90982";
out.meta.recordedAt = new Date().toISOString();
writeFileSync(new URL("./scores.json", import.meta.url), JSON.stringify(out) + "\n");
console.log("已寫入 scores.json：", Object.entries(out.variants).map(([k, v]) => `${k}:${Object.keys(v).length}題`).join(" "));
