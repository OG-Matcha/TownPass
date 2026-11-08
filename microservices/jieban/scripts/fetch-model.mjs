// 下載裝置端語意模型（Microsoft multilingual-e5-small，MIT）到 public/models。
// 檔案 113 MB 超過 GitHub 單檔上限，所以不進 git；建置 App 前跑一次：npm run fetch:model
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const REPO = "Xenova/multilingual-e5-small";
const REV = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"; // 釘選 commit
const FILES = ["config.json", "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];

for (const f of FILES) {
  const out = new URL(`../public/models/${REPO}/${f}`, import.meta.url);
  const res = await fetch(`https://huggingface.co/${REPO}/resolve/${REV}/${f}`);
  if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
  await mkdir(dirname(out.pathname.replace(/^\/([A-Za-z]:)/, "$1")), { recursive: true });
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log("✓", f);
}
