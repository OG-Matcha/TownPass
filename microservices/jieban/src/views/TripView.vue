<script setup lang="ts">
// 路上：下一步卡片，一次只看一段（單手、陽光下、手機架在輪椅上也能一眼看懂）。
// 底部一個大按鈕「我到了，下一步」；每張卡可以唸出來。
// 出發時問一次「路上你想怎麼知道下一步？」（看畫面／唸給我聽／唸給我聽我用講的）。
// 需要幫忙 → 先問「發生什麼事？」分三條：電梯不能用就換一條路、找不到電梯就說電梯在哪、請站務人員（求助卡、客服、本人確認才通知家人）。
// 分享給家人是選用的：本人按了才上傳，只分享到了哪一站。
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { ArrowRightLeft, Check, Copy, Eye, ExternalLink, LifeBuoy, MapPin, MessageCircle, MessageSquareText, Mic, Share2, UserRound, Volume2, X } from "lucide-vue-next";
import { destinationOf } from "@/lib/places";
import PageHeader from "@/components/PageHeader.vue";
import DisplaySettings from "@/components/DisplaySettings.vue";
import CallButton from "@/components/CallButton.vue";
import ElevatorPath from "@/components/ElevatorPath.vue";
import SlideConfirm from "@/components/SlideConfirm.vue";
import { openExternal } from "@/lib/bridge";
import { loadServices, services } from "@/lib/services";
import { canSpeak, speakAndWait, stopSpeaking } from "@/lib/speech";
import { buzz, feedback } from "@/lib/feedback";
import { classifyIntent, type Intent } from "@/lib/intent";
import { rerouteSpoken, spokenCards } from "@/lib/spoken";
import ListeningSheet from "@/components/ListeningSheet.vue";
import { carsId, doorId, exitsId, lineId, pathId, speechLocale, t } from "@/lib/i18n";
import { has, hand, lang, stepFont } from "@/lib/settings";
import { listenOnce, voiceSource } from "@/lib/voiceInput";
import { go, replace } from "@/lib/router";
import { showSnack } from "@/lib/snackbar";
import { ASK_AFTER_NO_REPLY_MIN, helpChoice } from "@/lib/trip";
import { tripStoreMode } from "@/lib/tripStore";
import {
  LINE_NAME,
  TRANSFER_HINT,
  avoidExit,
  destExitOf,
  exitList,
  exitsLeft,
  facilities,
  gateAt,
  pathText,
  rerouteAround,
  short,
  spotOf,
  status,
  stepsOf,
  type Snapshot,
  type Step,
} from "@/lib/planner";
import type { Entrance } from "@/lib/station";
import type { StationStatus } from "@/lib/station";
import * as S from "@/lib/tripSession";

const { trip, active, here, link, syncOk, demo, tripSnap, shared } = S;
const place = computed(() => destinationOf(tripSnap.value?.target));
const speechOk = canSpeak();
const report1999 = computed(() => services.value.find((x) => x.id === "report-1999") ?? null);
onMounted(() => void loadServices());


onMounted(() => {
  if (!trip.value) replace("#/");
  // 提示列（復原）要在底部操作列上方，不能蓋住「下一步」
  document.documentElement.style.setProperty("--snack-bottom", "272px");
});
onUnmounted(() => document.documentElement.style.removeProperty("--snack-bottom"));

// ---- 下一步卡片：和行程節點一一對應 ----
// 看護模式（lang = id）：卡片換成印尼語；站名、出口編號留中文對照現場指標；need（求助卡）永遠中文。
type Card = { kind: "ride" | "transfer" | "exit"; where: string; lines: string[]; path: string | null; st: StationStatus | null; need: string; done: string };
const ID = computed(() => lang.value === "id");
function stText(st: StationStatus | null): { ok: boolean; text: string } {
  if (!st) return { ok: true, text: "" };
  const id = ID.value;
  if (st.blocked) return { ok: false, text: id ? `Semua lift pintu keluar di ${st.station} dijadwalkan perawatan siang ini` : `${st.station}所有無障礙出口電梯白天都排定保養` };
  const parts: string[] = [];
  if (st.dayExitWork.length) {
    const places = st.dayExitWork.map((m) => m.place).join("、");
    parts.push(id ? `lift ${places} perawatan siang hari` : `${places}電梯白天排定保養`);
  }
  if (st.dayPlatformWork.length) parts.push(id ? "lift peron perawatan siang hari" : "月臺電梯白天排定保養");
  for (const a of st.anomalies) parts.push(a.text);
  if (parts.length) return { ok: false, text: `${st.station}：${parts.join("；")}` };
  return { ok: true, text: id ? `${st.station}: hari ini tidak ada jadwal perawatan lift (kerusakan mendadak tidak termasuk)` : `${st.station}今天沒有排定電梯保養（不含臨時故障）` };
}
const rideLines = (s: Extract<Step, { kind: "ride" }>) =>
  ID.value
    ? [
        `Naik ${lineId(s.line)} arah ${short(s.toward)}${s.cars ? `, naik di ${carsId(s.cars)} (tempat kursi roda)` : ""}`,
        `${s.stops} stasiun sampai ${s.to}${s.door ? `, ${doorId(s.door)}` : ""}`,
      ]
    : [`搭${LINE_NAME[s.line]}，往${short(s.toward)}方向${s.cars ? `，在${s.cars}上車（輪椅停靠）` : ""}`, `坐 ${s.stops} 站到${s.to}${s.door ? `，${s.door}` : ""}`];
const pathLine = (p: string, exit = false) => (ID.value ? pathId(pathText(p, exit)) : pathText(p, exit));
const cards = computed<Card[]>(() => {
  const snap = tripSnap.value;
  const steps = stepsOf(snap);
  if (!snap || !steps.length) return [];
  const id = ID.value;
  const out: Card[] = [];
  const date = snap.date;
  steps.forEach((s, i) => {
    if (s.kind === "enter") return; // 和第一段搭乘合成一張
    if (s.kind === "ride") {
      const prev = steps[i - 1];
      const done = id ? `Sudah sampai ${short(s.to)}, lanjut` : `我到${short(s.to)}了，下一步`;
      if (prev?.kind === "enter") {
        const path = prev.fac?.path ? pathLine(prev.fac.path) : null;
        out.push({
          kind: "ride",
          where: prev.st.station,
          lines: [id ? `Masuk dari ${exitsId(prev.st.entrances)}` : `從${exitList(prev.st)}進站`, ...rideLines(s)],
          path,
          st: prev.st,
          need: `我要搭電梯到月臺，搭${LINE_NAME[s.line]}往${short(s.toward)}方向。`,
          done,
        });
      } else {
        out.push({ kind: "ride", where: s.from, lines: rideLines(s), path: null, st: status(s.to, date), need: `我要搭${LINE_NAME[s.line]}到${s.to}。`, done });
      }
    } else if (s.kind === "transfer") {
      out.push({
        kind: "transfer",
        where: s.station,
        lines: s.sameLine
          ? [id ? `Turun di ${s.station}, ganti ke kereta cabang` : `在${s.station}下車，換搭支線的車`]
          : id
            ? [`Di ${s.station} pindah ke ${lineId(s.to)}`, "Ikuti tanda aksesibel menuju lift. Kalau tidak ketemu, tekan interkom di samping lift atau tanya bagian informasi."]
            : [`在${s.station}換搭${LINE_NAME[s.to]}`, TRANSFER_HINT],
        path: null,
        st: s.st,
        need: `我要在這站換搭${LINE_NAME[s.to]}，請帶我到電梯。`,
        done: id ? "Sudah pindah, lanjut" : "換好了，下一步",
      });
    } else {
      const path = s.fac?.path ? pathLine(s.fac.path, true) : null;
      out.push({
        kind: "exit",
        where: s.st.station,
        lines: [
          id ? `Keluar dari ${exitsId(s.st.entrances)}` : `從${exitList(s.st)}出站`,
          ...(s.fac?.toilet ? [id ? `Toilet aksesibel: ${s.fac.toilet}` : `無障礙廁所：${s.fac.toilet}`] : []),
        ],
        path,
        st: s.st,
        need: `我要從${s.st.station}搭電梯出站。`,
        done: id ? "Sudah keluar stasiun" : "我出站了",
      });
    }
  });
  return out;
});
const idx = computed(() => Math.min(trip.value?.reached ?? 0, Math.max(0, cards.value.length - 1)));
const card = computed(() => cards.value[idx.value] ?? null);
const cardSt = computed(() => stText(card.value?.st ?? null));
/** 電梯怎麼走：預設收合，點開或連說兩次「再說一次」才展開 */
const pathOpen = ref(false);
watch(idx, () => (pathOpen.value = false));
/** 搭車這一步：約幾分鐘後到（依時間表）；有開語音才說「到了會提醒你」 */
const eta = computed(() => {
  const m = trip.value?.milestones[idx.value];
  if (!m || card.value?.kind !== "ride") return "";
  const n = Math.round((m.expectedAt - tick.value) / 60_000);
  return n > 0 ? t.value.eta(n, voiceMode.value) : t.value.etaDue;
});
// ---- 念給耳朵聽：spoken.ts 另外寫一份口語稿（≤ 40 字、不念符號）；細節（電梯動線）要再問才念 ----
const spoken = computed(() => spokenCards(stepsOf(tripSnap.value), tripSnap.value?.date ?? "", lang.value));
const voiceMode = computed(() => has("noLook") || has("handsBusy"));
const say = (text: string) => speakAndWait(text, speechLocale.value);
let lastSaid = "";
async function sayStep(prefix = "") {
  const s = spoken.value[idx.value];
  if (!s) return;
  lastSaid = "step";
  await say(prefix + s.short);
  // 兩隻手都在忙：念完自動聽一句，不用先按「用講的」
  if (has("handsBusy") && !paused.value && active.value && !L.on) void listen(true);
}
const speakCard = () => void sayStep();

const cardEl = ref<HTMLElement | null>(null);
const cardStart = ref(S.now());
watch(idx, () => (cardStart.value = S.now()));
/** 比預計時間早很多就要往下一步（口袋誤觸、旁人講話被聽成「到了」）→ 先確認 */
function tooEarly() {
  const t0 = trip.value;
  if (demo || !t0) return false;
  const m = t0.milestones[idx.value];
  const prev = idx.value ? t0.milestones[idx.value - 1].expectedAt : cardStart.value;
  const expected = m ? m.expectedAt - prev : 0;
  return expected > 2 * 60_000 && S.now() - cardStart.value < expected * 0.4;
}
/** 往下一步。how：按鈕（看得到、按得到）／語音／長按。非按鈕的方式都會念出新的一步並提供復原。 */
async function advance(how: "button" | "voice" | "hold") {
  rerouted.value = null;
  await S.arrivedAtNext();
  cardEl.value?.focus();
  feedback("ok");
  if (!active.value) {
    if (voiceMode.value || how !== "button") void say(t.value.arrivedAll);
    return;
  }
  showSnack(t.value.stepOf(idx.value + 1, cards.value.length), () => S.goBack());
  if (voiceMode.value || how !== "button") await sayStep(`${t.value.movedTo(idx.value + 1)}`);
}
const nextStep = () => advance("button");
onMounted(() => !S.askMode.value && voiceMode.value && active.value && void sayStep());

// ---- 出發時問一次：路上你想怎麼知道下一步？ ----
const askingMode = computed(() => S.askMode.value && active.value);
const dontAsk = ref(S.askModeOff.value);
const modeEl = ref<HTMLElement | null>(null);
watch(askingMode, (a) => a && setTimeout(() => modeEl.value?.focus(), 50), { immediate: true });
/** 關掉不選：沿用現在的操作設定 */
function closeMode() {
  S.askMode.value = false;
  S.askModeOff.value = dontAsk.value;
  cardEl.value?.focus();
  if (voiceMode.value) void sayStep();
}
function pickMode(m: S.TripMode) {
  S.chooseMode(m, dontAsk.value);
  feedback("ok");
  cardEl.value?.focus();
  if (voiceMode.value) void sayStep();
}

// ---- 用講的：按下就有提示音＋震動＋全幅「正在聽」；聽到先複述，再執行並念出結果 ----
const voiceOk = voiceSource() !== "none";
const paused = ref(false);
const L = reactive({ on: false, state: "listening" as "listening" | "thinking" | "heard" | "error", text: "", hint: "" });
let seq = 0;
const AUTO_LISTEN_MS = 8000;
// 確認（例如比預計早很多就要換步）：用「觸發它的同一種方式」就能回答，不能逼不能講話的人用講的。
// 長按觸發 → 再長按一次＝確認；按鈕觸發 → 畫面上兩顆鈕；用講的觸發 → 說「對」。畫面鈕一律都有（看得到的人隨時可按）。
let confirmFn: (() => void) | null = null;
let confirmHow: "button" | "voice" | "hold" = "button";
const pending = ref<{ text: string; yes: string; no: string } | null>(null);
let pendingTimer = 0;
function clearPending() {
  confirmFn = null;
  pending.value = null;
  clearTimeout(pendingTimer);
}
function confirmYes() {
  const fn = confirmFn;
  clearPending();
  fn?.();
}
function confirmNo() {
  const viaVoice = confirmHow === "voice" || has("handsBusy");
  clearPending();
  // 用講的回答「不要」之後麥克風要接著開，不然兩隻手都在忙的人下一句沒地方講
  void say(t.value.keepGoing).then(() => viaVoice && followUp());
}
/** 用講的操作時，念完回覆後讓麥克風接著開（不用再按「用講的」）。 */
function followUp() {
  if (voiceOk && !has("noTalk") && active.value && !paused.value && !L.on) void listen(true);
}
async function listen(auto = false) {
  if (L.on) return;
  const my = ++seq;
  Object.assign(L, { on: true, state: "listening", text: "", hint: t.value.talkHint });
  feedback("listen");
  let text = "";
  try {
    // 自動聽 8 秒沒聲音就收起（App 沒回應時不要擋畫面 20 秒）；自己按「用講的」維持原本的等待時間
    text = await (auto ? listenOnce(speechLocale.value, AUTO_LISTEN_MS) : listenOnce(speechLocale.value));
  } catch {
    if (my !== seq) return;
    if (auto) return void (L.on = false); // 自動聽沒聽到人說話：安靜收起，不打擾
    Object.assign(L, { state: "error", text: "" });
    feedback("fail");
    return void setTimeout(() => my === seq && (L.on = false), 1500);
  }
  if (my !== seq || !L.on) return;
  Object.assign(L, { state: "thinking", text });
  feedback("heard");
  const r = await classifyIntent(text);
  L.state = "heard";
  await new Promise((res) => setTimeout(res, 600)); // 讓人看得到「聽到：…」
  if (my !== seq) return;
  L.on = false;
  await act(r.intent, text, auto);
}
function cancelListen() {
  seq++;
  L.on = false;
}
const talk = () => void listen(false);
const YES = /(對|是|確定|好|要|沒錯|嗯|ya|iya|betul|ok)/i;
/** question 不給 → 「比預計早很多」的問句（依觸發方式）。 */
async function confirm(how: "button" | "voice" | "hold", fn: () => void, question?: string, yes?: string, no?: string) {
  confirmFn = fn;
  confirmHow = how;
  const spoken = question ?? (how === "voice" ? t.value.early : how === "hold" ? t.value.earlyHold : t.value.earlyTap);
  pending.value = { text: question ?? (how === "hold" ? t.value.earlyHold : t.value.earlyTap), yes: yes ?? t.value.earlyYes, no: no ?? t.value.earlyNo };
  clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(clearPending, 20_000); // 20 秒沒回答就當作沒事，繼續這一步
  await say(spoken);
  // 只有用講的觸發、而且聽得到時才自動聽；長按或按鈕觸發的人可能不方便講話
  if (how === "voice" && voiceOk && !has("noTalk")) void listen(true);
}
async function act(intent: Intent | "unsure", text: string, auto: boolean) {
  // 「發生什麼事？」面板開著：用簡單規則挑選項
  if (helpOpen.value && helpView.value === "menu" && !confirmFn) {
    const c = helpChoice(text);
    if (c) {
      await pickHelp(c);
      return followUp();
    }
    if (!auto) await say(t.value.helpAsk);
    return;
  }
  if (confirmFn) {
    if (YES.test(text) && !/(不|別|tidak|jangan)/.test(text)) return confirmYes();
    return confirmNo();
  }
  // 求助面板、求助卡開著時說「到了／上一步／再說一次…」＝回到路上（講話的人看不到也按不到面板的關閉鈕）
  if ((helpOpen.value || showCard.value) && ["next", "back", "repeat", "end", "pause", "resume", "bigger"].includes(intent)) {
    helpOpen.value = false;
    showCard.value = false;
  }
  switch (intent) {
    case "next":
      if (tooEarly()) return confirm("voice", () => void advance("voice"));
      return advance("voice");
    case "repeat": {
      // 連說兩次「再說一次」→ 念細節（電梯動線）
      const d = spoken.value[idx.value]?.detail;
      if (lastSaid === "step-repeat" && d) {
        lastSaid = "detail";
        pathOpen.value = true;
        return void say(d).then(() => has("handsBusy") && followUp());
      }
      await sayStep();
      lastSaid = "step-repeat";
      return;
    }
    case "help": {
      openHelp();
      const c = helpChoice(text);
      if (c) {
        await pickHelp(c);
        return followUp();
      }
      await say(t.value.helpAsk);
      return void listen(true);
    }
    case "bigger":
      stepFont(1);
      return void say(t.value.biggerDone);
    case "back":
      await S.goBack();
      feedback("ok");
      return sayStep(t.value.backDone);
    case "pause":
      paused.value = true;
      stopSpeaking();
      return void say(t.value.paused);
    case "resume":
      paused.value = false;
      return sayStep(t.value.resumed);
    case "end":
      return confirm("voice", endTrip, t.value.confirmEnd, t.value.endYes, t.value.endNo);
    default:
      // 自動聽到的旁人對話（「媽你等一下」）不回應；自己按的才反問
      if (!auto) await confirm("voice", () => void advance("voice"), t.value.askAgain, t.value.nextYes, t.value.endNo);
  }
}

// ---- 快到站主動提醒（不方便看螢幕、兩隻手都在忙）：依時間表，不靠地下不準的 GPS ----
const announced = new Set<string>();
function proactive() {
  const tr = trip.value;
  if (!active.value || paused.value || !voiceMode.value || !tr || L.on || askingMode.value || helpOpen.value) return;
  const m = tr.milestones[idx.value];
  const c = card.value;
  if (!m || !c || c.kind !== "ride") return;
  const left = m.expectedAt - S.now();
  const name = short(m.station);
  const key = `${tr.id}:${idx.value}`;
  if (left <= 90_000 && left > 0 && !announced.has(`soon:${key}`)) {
    announced.add(`soon:${key}`);
    void say(t.value.soon(name));
  } else if (left <= 0 && !announced.has(`due:${key}`)) {
    announced.add(`due:${key}`);
    announced.add(`soon:${key}`);
    void say(t.value.due(name)).then(() => has("handsBusy") && void listen(true));
  }
}

// ---- 長按螢幕任何地方一秒 = 下一步（不方便看螢幕、按不準）----
// 防口袋誤觸：要按住不動 1 秒（布料摩擦多是短觸或滑動）、移動超過 12px 就取消、多指不算；
// 比預計早很多會先問；換步後念出新的一步，並給「上一步」復原。
const HOLD_MS = 1000;
const holdOn = computed(() => active.value && !askingMode.value);
/** 提示只給用不看螢幕／按不準的人；其他人保持畫面乾淨（長按仍然可用） */
const holdHintOn = computed(() => holdOn.value && (has("noLook") || has("imprecise")));
const hold = reactive({ on: false, x: 0, y: 0, p: 0 });
let holdT0 = 0;
let holdRaf = 0;
function holdDown(e: PointerEvent) {
  if (!holdOn.value || !e.isPrimary || L.on) return;
  if ((e.target as HTMLElement).closest("button, a, input, summary, label, details[open] > *, [role=dialog]")) return;
  Object.assign(hold, { on: true, x: e.clientX, y: e.clientY, p: 0 });
  holdT0 = performance.now();
  buzz("heard");
  const tick = () => {
    if (!hold.on) return;
    hold.p = Math.min(1, (performance.now() - holdT0) / HOLD_MS);
    if (hold.p >= 1) return holdDone();
    holdRaf = requestAnimationFrame(tick);
  };
  holdRaf = requestAnimationFrame(tick);
}
function holdMove(e: PointerEvent) {
  if (hold.on && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 12) holdCancel();
}
function holdCancel() {
  hold.on = false;
  cancelAnimationFrame(holdRaf);
}
// 放開時已經按滿一秒就算數（主執行緒忙的時候，動畫可能還沒更新到 100%）
function holdUp() {
  if (hold.on && performance.now() - holdT0 >= HOLD_MS) holdDone();
  else holdCancel();
}
function holdDone() {
  holdCancel();
  if (confirmFn) return confirmYes(); // 第二次長按＝確認
  if (tooEarly()) return void confirm("hold", () => void advance("hold"));
  void advance("hold");
}

// ---- 分享給家人（選用，在出發面板裡問）：按了 LINE／簡訊／複製才開始分享 ----
const name = ref("家人");
async function ensureShared() {
  if (!shared.value) await S.share(name.value);
}
const shareText = computed(() => `我要搭捷運從${trip.value?.origin}到${trip.value?.dest}，這個連結可以看到我到了哪一站：${link.value}`);
async function shareLine() {
  await ensureShared();
  openExternal(`https://line.me/R/msg/text/?${encodeURIComponent(shareText.value)}`);
}
async function shareSms() {
  await ensureShared();
  openExternal(`sms:?body=${encodeURIComponent(shareText.value)}`);
}
const copied = ref(false);
async function copyLink() {
  await ensureShared();
  try {
    await navigator.clipboard.writeText(shareText.value);
    copied.value = true;
    showSnack("已複製，可以貼到任何聊天軟體");
  } catch {
    showSnack("沒辦法自動複製，請長按下面的連結複製");
  }
}
async function stopShare() {
  if (!(await S.stopShare())) {
    showSnack("沒有網路，還沒停止分享，家人的連結可能仍有效。請連上網路再按一次");
    return;
  }
  copied.value = false;
  showSnack("已停止分享，家人的連結失效");
}
function endTrip() {
  const before = trip.value;
  S.end();
  if (before) showSnack(shared.value ? "已結束，家人的連結失效" : "已結束這趟", () => S.restore(before));
}

// ---- 需要幫忙：先問「發生什麼事？」----
type HelpView = "menu" | "where" | "exits" | "none";
const helpOpen = ref(false);
const helpView = ref<HelpView>("menu");
const showCard = ref(false);
// 關掉求助面板或求助卡：正在念的那段停掉（同步停，關掉之後要念的新句子不受影響）
watch([helpOpen, showCard], ([h, c], [ph, pc]) => {
  if ((ph && !h) || (pc && !c)) stopSpeaking();
}, { flush: "sync" });
const confirmNotify = ref(false);
/** 求助卡上的「我現在在」 */
const helpWhere = computed(() => card.value?.where ?? here.value);
/** 這一步要用到的電梯在哪一站（搭車中 = 下一個要搭電梯的站） */
const spot = computed(() => spotOf(stepsOf(tripSnap.value), idx.value));
const elevWhere = computed(() => spot.value?.station ?? helpWhere.value);
const elevExits = computed(() => (tripSnap.value && elevWhere.value ? exitsLeft(tripSnap.value, elevWhere.value) : []));
const elevPath = computed(() => facilities.value.find((f) => f.station === elevWhere.value && f.path)?.path ?? null);
/** 這一步搭的那班車的輪椅停靠車廂（轉乘、出站卡用前一段） */
const elevCars = computed(() => {
  const steps = stepsOf(tripSnap.value).filter((s) => s.kind !== "enter");
  for (let i = idx.value; i >= 0; i--) {
    const s = steps[i];
    if (s?.kind === "ride") return s.cars;
  }
  return null;
});
const exitWord = (e: Entrance) => (ID.value ? exitsId([e]) : `${e.exit}（${e.kind === "ramp" ? "坡道" : "電梯"}）`);
const helpEl = ref<HTMLElement | null>(null);
function openHelp() {
  if (trip.value?.state === "asking") S.imOk();
  helpView.value = "menu";
  helpOpen.value = true;
  setTimeout(() => helpEl.value?.focus(), 50);
}
function pickHelp(c: 1 | 2 | 3): Promise<void> | void {
  if (c === 1) return helpBroken();
  if (c === 2) return helpFind();
  return helpStaff();
}
// 1. 電梯不能用：同一站還有別的出口 → 問是哪一個壞了；不然換一條路（鄰站／別的轉乘站）
function helpBroken(): Promise<void> | void {
  const sp = spot.value;
  if (sp && (sp.kind === "enter" || sp.kind === "exit") && elevExits.value.length >= 2) {
    helpView.value = "exits";
    setTimeout(() => helpEl.value?.focus(), 50);
    return;
  }
  return rerouteStation();
}
function brokenExit(e: Entrance) {
  const sp = spot.value;
  const snap = tripSnap.value;
  if (!sp || !snap) return;
  const next = avoidExit(snap, sp.station, e.exit);
  const left = exitsLeft(next, sp.station);
  const use = left.find((x) => x.kind === "elevator") ?? left[0];
  if (!use) return rerouteStation();
  const enter = sp.kind === "enter";
  applyReroute(next, true, rerouteSpoken({ kind: "exit", exit: use.exit, ramp: use.kind === "ramp", enter }, lang.value), t.value.changeExit(exitWord(use), enter));
}
function rerouteStation(): Promise<void> | void {
  const sp = spot.value;
  const snap = tripSnap.value;
  const r = sp && snap ? rerouteAround(snap, sp) : null;
  if (!r) {
    helpView.value = "none";
    setTimeout(() => helpEl.value?.focus(), 50);
    feedback("fail");
    return say(t.value.noRerouteSay);
  }
  const c = r.change;
  const text =
    c.kind === "transfer"
      ? rerouteSpoken({ kind: "transfer", via: c.via, dest: r.snap.dest }, lang.value)
      : rerouteSpoken(c.kind === "origin" ? { kind: "origin", station: c.station } : { kind: "dest", station: c.station }, lang.value);
  const shown =
    c.kind === "transfer"
      ? t.value.changeTransfer(c.via, r.snap.dest)
      : c.kind === "origin"
        ? t.value.changeOrigin(c.station, c.meters)
        : t.value.changeDest(c.station, c.meters);
  return applyReroute(r.snap, false, text, shown);
}
/** 換好路線：關面板、畫面上方寫出改了什麼（可復原）、念一句 */
const rerouted = ref<string | null>(null);
function applyReroute(snap: Snapshot, sameRoute: boolean, spokenText: string, shown: string): Promise<void> {
  const before = S.reroute(snap, { sameRoute, destExit: destExitOf(snap.dest) });
  helpOpen.value = false;
  // 換路線會回到第 1 步：等步驟更新完再顯示（advance 會清掉它）
  setTimeout(() => (rerouted.value = shown), 0);
  feedback("ok");
  showSnack(t.value.undoReroute, () => {
    void S.undoReroute(before);
    rerouted.value = null;
  });
  setTimeout(() => cardEl.value?.focus(), 50);
  return say(spokenText);
}
// 2. 找不到電梯：大字寫出電梯在哪，同時念出來（用口語稿的動線，沒有就念這一步）
function helpFind(): Promise<void> | void {
  helpView.value = "where";
  setTimeout(() => helpEl.value?.focus(), 50);
  const s = spoken.value[idx.value];
  if (s) return say(s.detail ?? s.short);
}
// 3. 請站務人員：全螢幕求助卡（永遠中文）、打客服、本人確認才通知家人
function helpStaff() {
  helpOpen.value = false;
  showCard.value = true;
}

// ---- 「還好嗎？」倒數 ----
const tick = ref(S.now());
const timer = setInterval(() => ((tick.value = S.now()), proactive()), 1000);
onUnmounted(() => clearInterval(timer));
watch(trip, () => (tick.value = S.now()));
const askLeft = computed(() => {
  const t = trip.value;
  if (t?.state !== "asking" || !t.askedAt) return "";
  const ms = Math.max(0, t.askedAt + ASK_AFTER_NO_REPLY_MIN * 60_000 - tick.value);
  return `${Math.floor(ms / 60000)} 分 ${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")} 秒`;
});
const asking = computed(() => trip.value?.state === "asking" || (!shared.value && trip.value?.state === "no-response"));
const askEl = ref<HTMLElement | null>(null);
watch(asking, (a) => a && setTimeout(() => askEl.value?.focus(), 50));
const helpState = computed(() => shared.value && (trip.value?.state === "needs-help" || trip.value?.state === "no-response"));

function finish() {
  S.clearIfDone();
  go("#/");
}
</script>

<template>
  <PageHeader :title="ID ? 'Langkah demi langkah' : '一步一步'" :back-label="ID ? 'Kembali' : undefined"><DisplaySettings /></PageHeader>
  <main
    v-if="trip"
    class="space-y-4 p-4"
    :class="[active ? (has('imprecise') ? 'pb-80' : 'pb-64') : 'pb-12', holdOn ? 'min-h-dvh touch-pan-y select-none' : '']"
    :lang="ID ? 'id' : undefined"
    @pointerdown="holdDown"
    @pointermove="holdMove"
    @pointerup="holdUp"
    @pointercancel="holdCancel"
    @pointerleave="holdCancel"
  >
    <p v-if="!syncOk && active && shared" role="alert" class="tp-card text-body font-semibold text-danger">沒有網路：家人暫時看不到最新狀態，恢復連線後會自動更新。</p>

    <!-- 已讓家人知道 -->
    <section v-if="helpState" class="tp-card space-y-3 border-2 border-danger bg-red-50" aria-labelledby="helping">
      <h2 id="helping" class="text-title font-semibold" role="status">已讓家人知道你需要幫忙</h2>
      <button type="button" class="tp-btn" @click="showCard = true">給站務人員看的求助卡</button>
      <button type="button" class="tp-btn-outline" @click="S.imOk()">問題解決了</button>
    </section>

    <!-- 下一步卡片 -->
    <template v-if="active && card">
      <p v-if="rerouted" role="status" class="tp-card flex items-start gap-2 border-2 border-primary-500 text-title font-semibold" data-testid="rerouted">
        <ArrowRightLeft class="mt-0.5 size-6 shrink-0 text-primary-800" aria-hidden="true" /><span>{{ t.rerouted }}：{{ rerouted }}</span>
      </p>
      <h2 id="step-now" ref="cardEl" tabindex="-1" class="text-title font-semibold text-grayscale-800 outline-none">{{ t.stepOf(idx + 1, cards.length) }}</h2>
      <div class="flex gap-1" aria-hidden="true">
        <span v-for="(c, i) in cards" :key="i" class="h-2 flex-1 rounded-full" :class="i < idx ? 'bg-primary-500' : i === idx ? 'bg-primary-800' : 'bg-grayscale-200'" />
      </div>
      <section class="tp-card space-y-4 border-2 border-primary-500" aria-labelledby="step-now">
        <ul class="space-y-3">
          <li v-for="(l, i) in card.lines" :key="i" :class="i === 0 ? 'text-h2 leading-snug font-semibold' : 'text-h3'">{{ l }}</li>
        </ul>
        <p v-if="eta" class="text-title font-semibold text-primary-800" data-testid="eta">{{ eta }}</p>
        <!-- 沒問題就不顯示（一步只講一件事）；有排定保養才出現 -->
        <p v-if="!cardSt.ok" class="rounded-tp p-3 text-title font-semibold bg-red-50 text-danger">
          <span class="sr-only">{{ cardSt.ok ? t.okStatus : t.warnStatus }}</span>{{ cardSt.text }}
        </p>
      </section>
      <details v-if="card.path" class="tp-card" :open="pathOpen" data-testid="path" @toggle="pathOpen = ($event.target as HTMLDetailsElement).open">
        <summary class="flex min-h-16 cursor-pointer items-center text-title font-semibold">{{ t.pathToggle }} ›</summary>
        <ElevatorPath
          v-if="!ID && elevPath"
          class="pt-2"
          :path="elevPath"
          :leaving="spot?.kind === 'exit'"
          :station="elevWhere ?? undefined"
          :gate="gateAt(elevWhere)"
          :speakable="speechOk"
          @speak="say"
        />
        <p v-else class="pt-2 text-h3">{{ card.path }}</p>
      </details>
      <p v-if="holdHintOn" class="text-center text-body font-semibold text-grayscale-800" data-testid="hold-hint">{{ t.holdHint }}</p>
      <p v-if="paused" role="status" class="text-center text-body font-semibold text-grayscale-800">{{ t.paused }}</p>

      <!-- 分享給家人：在出發面板裡問；分享中只留一行狀態＋停止分享 -->
      <div v-if="shared" class="flex items-center gap-3 rounded-tp bg-primary-50 px-4 py-2" data-testid="share-status">
        <Share2 class="size-6 shrink-0 text-primary-800" aria-hidden="true" />
        <p class="flex-1 text-body font-semibold text-grayscale-900">家人看得到你到哪一站</p>
        <button type="button" class="tp-link w-auto" @click="stopShare">停止分享</button>
      </div>
      <button v-else type="button" class="tp-link" @click="S.askMode.value = true"><Share2 class="size-6 shrink-0" aria-hidden="true" /><span>讓家人看到你到哪一站</span></button>

      <details class="tp-card">
        <summary class="flex min-h-16 cursor-pointer items-center text-title font-semibold">{{ t.allSteps }}</summary>
        <ol class="space-y-2 pt-2">
          <li v-for="(c, i) in cards" :key="i" class="flex gap-2 text-body" :aria-current="i === idx ? 'step' : undefined">
            <Check v-if="i < idx" class="mt-0.5 size-5 shrink-0 text-primary-800" aria-hidden="true" /><span v-else class="w-5 shrink-0 text-center font-semibold">{{ i + 1 }}</span>
            <span :class="i === idx ? 'font-semibold' : ''">{{ c.lines[0] }}<span class="sr-only">{{ i < idx ? "，已完成" : i === idx ? "，目前" : "" }}</span></span>
          </li>
        </ol>
      </details>
      <button type="button" class="tp-link" @click="endTrip">{{ t.end }}</button>
      <button v-if="demo" type="button" class="tp-btn-outline" data-miss-ignore @click="S.fastForward()">示範用：時間快轉 5 分鐘</button>
    </template>

    <!-- 到了／結束 -->
    <template v-if="!active">
      <section class="tp-card space-y-2" aria-labelledby="done-title">
        <h2 id="done-title" class="text-h2 font-semibold" role="status">{{ trip.state === "arrived" ? `已到達${trip.dest}` : "這趟已結束" }}</h2>
        <p v-if="trip.state === 'arrived'" class="text-body">出站後到目的地的路段資料沒有確認，慢慢來。</p>
      </section>
      <section v-if="trip.state === 'arrived' && place?.nextStep" class="tp-card space-y-3" aria-labelledby="arrive-next">
        <h2 id="arrive-next" class="text-title font-semibold">接下來：{{ place.name }}</h2>
        <button type="button" class="tp-btn-outline" @click="openExternal(place.nextStep.url)">
          <ExternalLink class="size-6 shrink-0" aria-hidden="true" /><span>{{ place.nextStep.label }}（開啟官方網頁）</span>
        </button>
      </section>
      <button type="button" class="tp-btn" @click="finish">回首頁</button>
    </template>
  </main>

  <!-- 長按進度圈：跟著手指，按滿一秒換下一步 -->
  <div v-if="hold.on" class="pointer-events-none fixed z-40 size-28 -translate-x-1/2 -translate-y-1/2" :style="{ left: `${hold.x}px`, top: `${hold.y}px` }" aria-hidden="true">
    <svg viewBox="0 0 100 100" class="size-full -rotate-90">
      <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,0.85)" stroke="var(--color-grayscale-200)" stroke-width="8" />
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--color-primary-800)" stroke-width="8" stroke-linecap="round" :stroke-dasharray="276.5" :stroke-dashoffset="276.5 * (1 - hold.p)" />
    </svg>
  </div>
  <!-- 確認：畫面上一定有兩顆鈕（不用講話也能答）；長按觸發的也可以再長按一次 -->
  <div v-if="pending" class="fixed inset-x-0 bottom-0 z-60 px-4 pb-6" data-miss-ignore>
    <div role="alertdialog" aria-labelledby="confirm-q" class="tp-card mx-auto max-w-xl space-y-4 border-2 border-primary-600 shadow-lg">
      <p id="confirm-q" class="text-h3 font-semibold">{{ pending.text }}</p>
      <div class="grid grid-cols-2 gap-4">
        <button type="button" class="tp-btn" data-testid="confirm-yes" @click="confirmYes">{{ pending.yes }}</button>
        <button type="button" class="tp-btn-outline" data-testid="confirm-no" @click="confirmNo">{{ pending.no }}</button>
      </div>
    </div>
  </div>
  <ListeningSheet v-if="L.on" :state="L.state" :transcript="L.text" :hint="L.hint" :lang="lang" @cancel="cancelListen" />

  <!-- 底部操作列：路上會用到的按鈕都在拇指範圍內。
       只有一隻手 → 整列縮到 4/5 寬、靠慣用手那側；按不準 → 「下一步」變成整片大按鈕。 -->
  <div v-if="active && card" class="fixed inset-x-0 bottom-0 z-30 bg-white p-4 shadow-[0_0_6px_rgba(0,0,0,0.1)]" :lang="ID ? 'id' : undefined" data-miss-ignore>
    <div class="mx-auto max-w-xl">
      <div class="space-y-3" :class="has('oneHand') ? (hand === 'left' ? 'mr-auto w-4/5' : 'ml-auto w-4/5') : ''" data-testid="trip-bar">
        <div class="flex gap-3" :class="hand === 'left' ? 'flex-row-reverse' : ''">
          <button v-if="speechOk" type="button" class="tp-tool" @click="speakCard"><Volume2 class="size-6 shrink-0" aria-hidden="true" /><span>{{ t.speak }}</span></button>
          <button v-if="voiceOk && !has('noTalk')" type="button" class="tp-tool" :aria-pressed="L.on" @click="talk">
            <Mic class="size-6 shrink-0" aria-hidden="true" /><span>{{ t.talk }}</span>
          </button>
          <button type="button" class="tp-tool tp-tool-danger" aria-haspopup="dialog" @click="openHelp"><LifeBuoy class="size-6 shrink-0" aria-hidden="true" /><span>{{ t.helpTool }}</span></button>
        </div>
        <button type="button" class="tp-btn text-title" :class="has('imprecise') ? 'min-h-28' : ''" @click="nextStep"><Check class="size-6 shrink-0" aria-hidden="true" /><span>{{ card.done }}</span></button>
      </div>
    </div>
  </div>

  <!-- 還好嗎？（全螢幕、搶焦點） -->
  <div v-if="asking && trip && !helpOpen && !askingMode" class="fixed inset-0 z-50 flex flex-col bg-white p-6" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-desc" :lang="ID ? 'id' : undefined" data-miss-ignore>
    <div class="flex-1 space-y-4">
      <h2 id="ask-title" ref="askEl" tabindex="-1" class="text-h2 font-semibold outline-none">{{ t.askTitle }}</h2>
      <p id="ask-desc" class="text-title">{{ shared && askLeft ? `${askLeft}後沒有回應，家人的頁面會變紅。` : t.askDesc }}</p>
      <p class="text-body text-grayscale-700">{{ t.nowStep }}{{ card?.lines[0] }}</p>
    </div>
    <div class="space-y-4">
      <button type="button" class="tp-btn text-title" @click="S.imOk()">{{ t.imOk }}</button>
      <button type="button" class="tp-btn-alarm" @click="openHelp">{{ t.helpTool }}</button>
    </div>
  </div>

  <!-- 出發時問一次：路上你想怎麼知道下一步？ -->
  <Teleport to="body">
    <div v-if="askingMode" class="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center" data-miss-ignore>
      <div role="dialog" aria-modal="true" aria-labelledby="mode-title" class="tp-sheet sm:mx-auto sm:max-w-xl sm:rounded-2xl" :lang="ID ? 'id' : undefined" data-testid="mode-sheet">
        <div class="tp-sheet-handle" aria-hidden="true" />
        <div class="flex items-center gap-3">
          <h2 id="mode-title" ref="modeEl" tabindex="-1" class="flex-1 text-h3 font-semibold outline-none">{{ t.modeTitle }}</h2>
          <button type="button" class="tp-icon-btn -mr-3" :aria-label="t.close" @click="closeMode"><X class="size-7" aria-hidden="true" /></button>
        </div>
        <div class="space-y-3">
          <button type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="mode-look" @click="pickMode('look')">
            <Eye class="size-8 shrink-0 text-primary-800" aria-hidden="true" />
            <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.modeLook }}</span><span class="block text-body text-grayscale-700">{{ t.modeLookSub }}</span></span>
          </button>
          <button v-if="speechOk" type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="mode-listen" @click="pickMode('listen')">
            <Volume2 class="size-8 shrink-0 text-primary-800" aria-hidden="true" />
            <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.modeListen }}</span><span class="block text-body text-grayscale-700">{{ t.modeListenSub }}</span></span>
          </button>
          <button v-if="speechOk && voiceOk" type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="mode-talk" @click="pickMode('talk')">
            <span class="flex shrink-0 items-center text-primary-800" aria-hidden="true"><Volume2 class="size-7" /><Mic class="size-7" /></span>
            <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.modeTalk }}</span><span class="block text-body text-grayscale-700">{{ t.modeTalkSub }}</span></span>
          </button>
        </div>
        <!-- 選用：讓家人看到你到哪一站（按了傳送方式才開始分享） -->
        <details class="rounded-tp border border-grayscale-500" data-testid="share-row" :open="shared">
          <summary class="flex min-h-16 cursor-pointer items-center gap-3 px-4 text-h3 font-semibold">
            <Share2 class="size-6 shrink-0 text-primary-800" aria-hidden="true" /><span class="flex-1">{{ shared ? "家人看得到你到哪一站" : "讓家人看到你到哪一站" }}</span><span class="text-body font-normal text-grayscale-700">選用</span>
          </summary>
          <div class="space-y-3 px-4 pb-4" lang="zh-Hant">
            <p class="text-body text-grayscale-700">只分享到了哪一站，不分享定位；結束後連結就失效，6 小時後自動刪除。比預計晚了會先問你，你 3 分鐘沒回應，家人頁才會變紅。</p>
            <label class="block"><span class="tp-label">家人看到的稱呼</span><input v-model="name" class="tp-field" maxlength="10" :disabled="shared" /></label>
            <button type="button" class="tp-btn-outline" @click="shareLine"><MessageCircle class="size-6 shrink-0" aria-hidden="true" /><span>用 LINE 傳</span></button>
            <button type="button" class="tp-btn-outline" @click="shareSms"><MessageSquareText class="size-6 shrink-0" aria-hidden="true" /><span>用簡訊傳</span></button>
            <button type="button" class="tp-link" @click="copyLink"><Copy class="size-6 shrink-0" aria-hidden="true" /><span>{{ copied ? "已複製" : "複製連結" }}</span></button>
            <p v-if="shared" class="break-all text-caption text-grayscale-700" data-testid="family-link">{{ link }}</p>
            <p v-if="shared && tripStoreMode === 'local'" class="text-caption text-grayscale-700">開發模式：家人頁要在同一台裝置開啟。</p>
          </div>
        </details>
        <label class="flex min-h-16 cursor-pointer items-center gap-4 px-1">
          <input v-model="dontAsk" type="checkbox" class="size-7 shrink-0 accent-primary-800" />
          <span class="text-h3">{{ t.modeDontAsk }}</span>
        </label>
      </div>
    </div>
  </Teleport>

  <!-- 需要幫忙：先問發生什麼事（底部面板） -->
  <div v-if="helpOpen && trip" class="fixed inset-0 z-50 flex items-end bg-black/50" data-miss-ignore @click.self="helpOpen = false">
    <div role="dialog" aria-modal="true" aria-labelledby="help-title" class="tp-sheet" :lang="ID ? 'id' : undefined" data-testid="help-sheet">
      <div class="tp-sheet-handle" aria-hidden="true" />
      <div class="flex items-center gap-3">
        <h2 id="help-title" ref="helpEl" tabindex="-1" class="flex-1 text-h3 font-semibold outline-none">
          {{ helpView === "menu" ? t.helpTitle : helpView === "where" ? t.whereElevator(elevWhere ?? "") : helpView === "exits" ? t.whichExit(elevWhere ?? "") : t.noReroute(elevWhere ?? "") }}
        </h2>
        <button type="button" class="tp-icon-btn -mr-3" :aria-label="t.close" @click="helpOpen = false"><X class="size-7" aria-hidden="true" /></button>
      </div>

      <div v-if="helpView === 'menu'" class="space-y-3">
        <button type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="help-broken" @click="helpBroken">
          <ArrowRightLeft class="size-8 shrink-0 text-primary-800" aria-hidden="true" />
          <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.helpBroken }}</span><span class="block text-body text-grayscale-700">{{ t.helpBrokenSub }}</span></span>
        </button>
        <button type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="help-find" @click="helpFind">
          <MapPin class="size-8 shrink-0 text-primary-800" aria-hidden="true" />
          <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.helpFind }}</span><span class="block text-body text-grayscale-700">{{ t.helpFindSub }}</span></span>
        </button>
        <button type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="help-staff" @click="helpStaff">
          <UserRound class="size-8 shrink-0 text-red-700" aria-hidden="true" />
          <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.helpStaff }}</span><span class="block text-body text-grayscale-700">{{ t.helpStaffSub }}</span></span>
        </button>
      </div>

      <template v-else-if="helpView === 'where'">
        <dl class="space-y-3 text-h3" data-testid="elevator-where">
          <div v-if="elevCars"><dt class="font-semibold">{{ t.carsLabel }}</dt><dd>{{ ID ? carsId(elevCars) : elevCars }}</dd></div>
          <div v-if="elevExits.length"><dt class="font-semibold">{{ t.exitsLabel }}</dt><dd>{{ elevExits.map(exitWord).join(ID ? ", " : "、") }}</dd></div>
          <div v-if="gateAt(elevWhere)"><dt class="font-semibold">{{ t.gateLabel }}</dt><dd>{{ gateAt(elevWhere) }}{{ t.gateNote }}</dd></div>
          <div v-if="elevPath"><dt class="font-semibold">{{ t.pathLabel }}</dt><dd>{{ ID ? pathId(pathText(elevPath, spot?.kind === "exit")) : pathText(elevPath, spot?.kind === "exit") }}</dd></div>
        </dl>
        <p class="text-body text-grayscale-700">{{ t.stillCant }}</p>
        <button type="button" class="tp-btn-alarm" @click="helpStaff">{{ t.helpStaff }}</button>
      </template>

      <div v-else-if="helpView === 'exits'" class="space-y-3">
        <button v-for="e in elevExits" :key="e.exit" type="button" class="tp-btn-outline justify-start text-left" @click="brokenExit(e)">{{ exitWord(e) }}</button>
        <button type="button" class="flex min-h-20 w-full items-center gap-4 rounded-tp border-2 border-primary-600 bg-white px-4 py-3 text-left text-grayscale-900 active:bg-primary-50" data-testid="help-all-broken" @click="rerouteStation">
          <ArrowRightLeft class="size-8 shrink-0 text-primary-800" aria-hidden="true" />
          <span class="flex-1"><span class="block text-h3 font-semibold">{{ t.allBroken }}</span><span class="block text-body text-grayscale-700">{{ t.allBrokenSub }}</span></span>
        </button>
      </div>

      <template v-else>
        <p v-if="elevExits.length" class="text-h3"><span class="font-semibold">{{ t.exitsLabel }}：</span>{{ elevExits.map(exitWord).join(ID ? ", " : "、") }}</p>
        <button type="button" class="tp-btn-alarm" @click="helpStaff">{{ t.helpStaff }}</button>
        <CallButton tel="0225363001" :label="t.callMetro" display="02-2536-3001" variant="outline" />
      </template>
      <button v-if="report1999" type="button" class="tp-link" data-testid="report-1999" @click="openExternal(report1999.url)"><ExternalLink class="size-6 shrink-0" aria-hidden="true" /><span>{{ t.report1999 }}</span></button>
    </div>
  </div>

  <!-- 求助卡：全螢幕大字，給站務人員看；聽障或說話不方便也能用 -->
  <!-- 看護模式：最上面一行印尼語告訴看護「把這頁給站務人員看」，其餘全中文給站務人員 -->
  <div v-if="showCard && trip" role="dialog" aria-modal="true" aria-labelledby="help-card" class="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-white">
    <p v-if="ID" lang="id" class="bg-secondary-100 p-4 text-h3 font-semibold text-grayscale-900">{{ t.cardFor }}</p>
    <div class="flex flex-1 flex-col justify-center space-y-6 p-6">
      <p class="text-h3 font-semibold text-grayscale-700">請協助我，我需要搭電梯</p>
      <p id="help-card" class="text-h1 leading-tight font-semibold text-balance">{{ card?.need ?? `我要到${trip.dest}。` }}</p>
      <dl class="space-y-2 border-t border-grayscale-200 pt-4">
        <div class="flex gap-3 text-h2"><dt class="shrink-0 text-grayscale-700">我現在在</dt><dd class="font-semibold">{{ helpWhere }}</dd></div>
        <div class="flex gap-3 text-h3"><dt class="shrink-0 text-grayscale-700">最後要到</dt><dd class="font-semibold">{{ trip.dest }}{{ trip.destExit ? ` ${trip.destExit}` : "" }}</dd></div>
      </dl>
    </div>
    <div class="space-y-3 p-4" :lang="ID ? 'id' : undefined">
      <CallButton tel="0225363001" :label="t.callMetro" display="02-2536-3001" variant="outline" />
      <button v-if="shared" type="button" class="tp-btn-outline" @click="(showCard = false), (confirmNotify = true)">{{ t.notifyFamily }}</button>
      <button type="button" class="tp-btn-outline" autofocus @click="showCard = false"><X class="size-6 shrink-0" aria-hidden="true" /><span>{{ t.close }}</span></button>
    </div>
  </div>

  <SlideConfirm
    v-if="confirmNotify && trip"
    title="要讓家人知道你需要幫忙嗎？"
    detail="家人的頁面會變紅，並看到你最後回報的車站。"
    action-label="通知家人"
    @confirm="
      S.needHelp('需要幫忙');
      confirmNotify = false;
    "
    @cancel="confirmNotify = false"
  />
</template>
