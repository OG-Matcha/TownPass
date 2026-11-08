import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// onnxruntime-web 預設會把 27 MB 的 asyncify wasm 一起打包；我們改用 public/ort 下的 14 MB 版本，刪掉多餘的
const dropBundledOrtWasm = {
  name: "drop-bundled-ort-wasm",
  generateBundle(_: unknown, bundle: Record<string, unknown>) {
    for (const k of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(k)) delete bundle[k];
  },
};

export default defineConfig({
  // 相對路徑：打包進 App 用 InAppLocalhostServer 或 file:// 也能載
  base: "./",
  plugins: [vue(), tailwindcss(), dropBundledOrtWasm],
  // 意圖模型在 module worker（src/lib/intentWorker.ts）；worker 另走一套打包，也要刪掉多餘的 ort wasm
  worker: { format: "es", plugins: () => [dropBundledOrtWasm] },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
