// 分享後端權限測試（不用部署，用假的 KV）：node scripts/worker-check.mjs
import worker from "../worker/trip-worker.js";

const store = new Map();
const env = {
  TRIPS: {
    async get(k, type) {
      const v = store.get(k);
      return v == null ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(k, v) {
      store.set(k, v);
    },
  },
};
const id = "abcdefgh12345678";
const owner = "a".repeat(32);
const stranger = "b".repeat(32);
const url = `https://x.test/trips/${id}`;
const put = (token, trip) =>
  worker.fetch(
    new Request(url, {
      method: "PUT",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(trip),
    }),
    env,
  );
const get = () => worker.fetch(new Request(url), env);

const results = [];
const check = (n, ok) => results.push([n, ok]);
check("沒帶權杖不能寫", (await put(null, { id, state: "on-track" })).status === 401);
check("旅客第一次寫入成功", (await put(owner, { id, state: "on-track" })).status === 204);
check("旅客之後寫入成功", (await put(owner, { id, state: "asking" })).status === 204);
check("別人的權杖不能改", (await put(stranger, { id, state: "arrived" })).status === 403);
const body = await (await get()).json();
check("家人讀到旅客寫的狀態", body.state === "asking");
check("讀取不含權杖雜湊", !("tokenHash" in body) && !JSON.stringify(body).includes("tokenHash"));
check("id 不符拒絕", (await put(owner, { id: "zzzzzzzz", state: "x" })).status === 400);

for (const [n, ok] of results) console.log(`${ok ? "✓" : "✗"} ${n}`);
const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} 項失敗` : "\n全部通過");
process.exit(failed ? 1 : 0);
