// 分享行程後端（Cloudflare Workers + KV，免費方案）。已部署：https://codefest-trip.jushenhuang-jason.workers.dev
// 只存「到哪一站」的行程狀態，不存定位；資料 6 小時後自動刪除（KV expirationTtl）。
// API：
//   PUT /trips/:id  旅客端寫入，必須帶 Authorization: Bearer <寫入權杖>
//                   第一次寫入時建立並記下權杖雜湊；之後權杖不符一律 403
//   GET /trips/:id  家人頁讀取，只回傳行程，不含權杖雜湊
// 家人連結只含 id，不含權杖 → 拿到連結的人只能看，不能改。
const TTL_SEC = 6 * 60 * 60;
const ID = /^[a-z0-9]{8,32}$/;
const TOKEN = /^[a-z0-9]{32,64}$/;
const MAX_BYTES = 16 * 1024;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env) {
    const cors = {
      "access-control-allow-origin": env.ALLOW_ORIGIN ?? "*",
      "access-control-allow-methods": "GET, PUT, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    };
    const reply = (body, status, extra = {}) => new Response(body, { status, headers: { ...cors, ...extra } });
    if (req.method === "OPTIONS") return reply(null, 204);
    const m = new URL(req.url).pathname.match(/^\/trips\/([^/]+)$/);
    if (!m || !ID.test(m[1])) return reply("not found", 404);
    const key = `trip:${m[1]}`;

    if (req.method === "GET") {
      const v = await env.TRIPS.get(key, "json");
      return v
        ? reply(JSON.stringify(v.trip), 200, { "content-type": "application/json", "cache-control": "no-store" })
        : reply("not found", 404);
    }

    if (req.method === "PUT") {
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!TOKEN.test(token)) return reply("unauthorized", 401);
      const body = await req.text();
      if (body.length > MAX_BYTES) return reply("too large", 413);
      let trip;
      try {
        trip = JSON.parse(body);
        if (trip.id !== m[1]) throw new Error("id mismatch");
      } catch {
        return reply("bad request", 400);
      }
      const hash = await sha256(token);
      const existing = await env.TRIPS.get(key, "json");
      if (existing && existing.tokenHash !== hash) return reply("forbidden", 403);
      await env.TRIPS.put(key, JSON.stringify({ tokenHash: hash, trip }), { expirationTtl: TTL_SEC });
      return reply(null, 204);
    }
    return reply("method not allowed", 405);
  },
};
