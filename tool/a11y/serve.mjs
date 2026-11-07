// 本機靜態伺服器：/demo/* → tool/a11y/demo，/tp-a11y.js → assets/a11y/tp-a11y.js
// 用法：node tool/a11y/serve.mjs [port]，再用桌面 Chrome 開 http://localhost:8787/demo/service.html
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const script = fileURLToPath(new URL("../../assets/a11y/tp-a11y.js", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

export function serve(port = 8787) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    let file = null;
    if (path === "/tp-a11y.js") file = script;
    else if (/^\/demo\/[\w-]+\.html$/.test(path)) file = here + path.slice(1);
    if (!file) {
      res.writeHead(404).end("not found");
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" }).end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8787);
  await serve(port);
  console.log(`http://localhost:${port}/demo/service.html`);
}
