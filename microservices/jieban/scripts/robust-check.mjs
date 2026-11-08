// 聯網／斷網修正的靜態檢查（不需 dev server）
import { readFileSync } from "node:fs";
const r = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
let bad = 0;
const ok = (c, m) => (console.log(`${c ? "✓" : "✗"} ${m}`), c || bad++);
const v = r("lib/voiceInput.ts"), sp = r("lib/speech.ts"), ts = r("lib/tripSession.ts"), st = r("lib/tripStore.ts"), fv = r("FamilyView.vue");
ok(/devVoice\(\) && webRecognition\(\)/.test(v) && /devvoice/.test(v), "瀏覽器語音需 ?devvoice 才開");
ok(/devVoice\(\) \? webRecognition\(\) : null/.test(v), "listenOnce 同樣受 ?devvoice 限制");
ok(/name !== "tts" \|\| !m\.data\?\.error/.test(sp) && /errShown/.test(sp) && /showSnack/.test(sp), "tts 錯誤回覆只提示一次");
ok(/export function speakAndWait/.test(sp) && /export function stopSpeaking/.test(sp), "speech 既有匯出仍在");
ok(/addEventListener\("online"/.test(ts) && /retrySync\(\)/.test(ts) && /export const goBack/.test(ts), "online 與 15 秒重送，goBack 仍在");
ok(/status === 404\) return null/.test(st) && /throw new Error\(`讀取失敗/.test(st), "只有 404 回 null，其他錯誤丟出");
ok(/onError/.test(st) && /網路不穩，顯示的是/.test(fv), "家人頁網路錯誤保留上次狀態並提示時間");
process.exit(bad ? 1 : 0);
