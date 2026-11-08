<script setup lang="ts">
// 出發前檢查：結論 → （有保養時）一行註解 → 出站之後 → 每一站怎麼走（收起）→ 出發。
// 預排保養由 autoFix 直接改好；本人只需要決定「出發」。每塊最多 3 行，次要資訊收起來。
import { computed, onMounted, ref, watch } from "vue";
import { ArrowRightLeft, ChevronDown, CircleCheck, ExternalLink, Info, Route as RouteIcon, TriangleAlert, Volume2 } from "lucide-vue-next";
import { openExternal } from "@/lib/bridge";
import { destinationOf, placeById, places } from "@/lib/places";
import PageHeader from "@/components/PageHeader.vue";
import CallButton from "@/components/CallButton.vue";
import ElevatorPath from "@/components/ElevatorPath.vue";
import LineBadge from "@/components/LineBadge.vue";
import FacilityIcon from "@/components/FacilityIcon.vue";
import MapFitPoints from "@/components/MapFitPoints.vue";
import { Map, MapControls, MapMarker, MarkerContent } from "@/components/ui/map";
import { canSpeak, speakText } from "@/lib/speech";
import { go, replace } from "@/lib/router";
import * as S from "@/lib/tripSession";
import { picked } from "@/lib/goState";
import { applyAutoFix, issuesOf, revertAutoFix } from "@/lib/autoFix";
import { lastMile, loadLastMile, summarize } from "@/lib/lastMile";
import { loadServices, servicesFor, services } from "@/lib/services";
import {
  LINE_NAME,
  TRANSFER_HINT,
  destExitOf,
  doPlan,
  entrances,
  exitAlt,
  exitList,
  fmtExit,
  orderExits,
  fetchedAt,
  isToday,
  mdw,
  net,
  origin,
  dest,
  result,
  short,
  stepText,
  steps,
  summaryText,
  type Step,
} from "@/lib/planner";
import { showSnack } from "@/lib/snackbar";

const r = computed(() => result.value);
const shortName = short;
const title = computed(() => (r.value ? `${shortName(r.value.origin)} → ${shortName(r.value.dest)}` : "路線"));
const today = computed(() => !!r.value && isToday(r.value.date));
const dayWord = computed(() => (!r.value ? "" : today.value ? "今天" : mdw(r.value.date)));
const speechOk = canSpeak();
const stamp = (d: Date | null) => (d ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "載入中");

// ---- 結論 ----
const issues = computed(() => (r.value?.plan ? issuesOf(r.value) : []));
const notes = computed(() => r.value?.autoFix?.notes ?? []);
const routeLine = computed(() => {
  const p = r.value?.plan;
  if (!p) return "";
  return `${shortName(r.value!.origin)} → ${shortName(r.value!.dest)}・約 ${p.totalMin} 分・${p.transfers.length ? `轉乘 ${p.transfers.length} 次` : "不用轉乘"}`;
});
// 起訖站所有出口都在保養：自動改不了（要換車站），給替代由本人決定
const blockedEnds = computed(() => steps.value.filter((s): s is Extract<Step, { kind: "enter" | "exit" }> => (s.kind === "enter" || s.kind === "exit") && s.st.blocked));
function useAlt(kind: "enter" | "exit", station: string) {
  const before = { o: origin.value, d: dest.value };
  if (kind === "enter") origin.value = station;
  else dest.value = station;
  doPlan();
  showSnack(`已改${kind === "enter" ? "從" : "到"}${station}`, () => {
    origin.value = before.o;
    dest.value = before.d;
    doPlan();
  });
}
const showExitWork = (s: { st: { blocked: boolean } }) => r.value?.autoFix?.state === "declined" || s.st.blocked;

// ---- 出站之後 ----
function ensureDestInfo() {
  const x = result.value;
  if (!x?.plan || x.destInfo || !places.value.length) return;
  const orig = x.options[0]?.dest ?? x.dest;
  const t = destinationOf(x.target);
  if (x.target && t) {
    result.value = { ...x, destInfo: { id: x.target.id, name: t.name, kind: placeById(x.target.id)?.kind ?? null, lat: t.lat, lng: t.lng } };
  } else {
    const h = picked.value;
    if (h && h.type !== "station" && h.lat !== undefined && h.lng !== undefined && h.station === orig)
      result.value = { ...x, destInfo: { id: h.id, name: h.name, kind: h.kind ?? null, lat: h.lat, lng: h.lng } };
  }
}
const dp = computed(() => r.value?.destInfo ?? null);
const exitInfo = computed(() => {
  const d = dp.value;
  const x = r.value;
  if (!d || !x) return null;
  const avoid = new Set(x.avoidExits ?? []);
  const e = orderExits(entrances.value.filter((c) => c.station === x.dest && !avoid.has(`${c.station}|${c.exit}`)), d)[0];
  if (!e) return null;
  const m = Math.hypot((e.lat - d.lat) * 110_540, (e.lng - d.lng) * 111_320 * Math.cos((d.lat * Math.PI) / 180));
  return { e, meters: Math.max(10, Math.round(m / 10) * 10) };
});
const lm = computed(() => (exitInfo.value && dp.value && lastMile.value ? summarize(lastMile.value, exitInfo.value.e, dp.value) : null));
const svc = computed(() => (services.value.length && dp.value ? servicesFor(dp.value) : []));

// ---- 每一站怎麼走（預設收起；地圖在裡面）----
const stepsOpen = ref(false);

async function depart() {
  const snap = result.value;
  if (!snap?.plan) return S.active.value ? go("#/trip") : undefined;
  // 同一條路線＝回到原本那趟；不同路線＝先問要不要結束現在這趟（App.vue 的對話框）；只會有一趟
  if ((await S.departFrom(JSON.parse(JSON.stringify(snap)), destExitOf(snap.dest, snap.destInfo ?? null))) === "go") go("#/trip");
}

const mapPoints = computed(() => (r.value ? entrances.value.filter((e) => e.station === r.value!.origin || e.station === r.value!.dest) : []));
const mapCenter = computed<[number, number]>(() => {
  const e = mapPoints.value[0];
  return e ? [e.lng, e.lat] : [121.517, 25.0478];
});
const speakAll = () => speakText([summaryText(), ...steps.value.map(stepText)].join(""));

onMounted(() => {
  if (!result.value) return replace("#/"); // 直接開進結果頁（沒有規劃）→ 回首頁
  loadLastMile();
  loadServices();
});
// 資料載入完才能判斷哪裡有保養；載入前不能標成「已處理」
watch(
  [() => net.value, () => entrances.value.length, () => result.value, () => places.value.length],
  () => {
    if (!net.value || !entrances.value.length || !result.value?.plan) return;
    applyAutoFix();
    ensureDestInfo();
  },
  { immediate: true },
);
</script>

<template>
  <PageHeader :title="title" />
  <main v-if="r" class="space-y-4 p-4 pb-32">
    <!-- 結論：第一眼就知道這趟走不走得通 -->
    <section class="tp-card space-y-2 border-2" :class="!r.plan ? 'border-grayscale-500' : issues.length ? 'border-danger' : 'border-primary-500'" aria-labelledby="verdict">
      <h2 v-if="r.plan" id="verdict" class="flex items-start gap-2 text-h2 leading-snug font-semibold" :class="issues.length ? 'text-danger' : 'text-grayscale-900'">
        <TriangleAlert v-if="issues.length" class="mt-1 size-8 shrink-0" aria-hidden="true" />
        <CircleCheck v-else class="mt-1 size-8 shrink-0 text-ok" aria-hidden="true" />
        <span>{{ dayWord }}這趟{{ issues.length ? `有 ${issues.length} 個地方要注意` : "可以走" }}</span>
      </h2>
      <h2 v-else id="verdict" class="text-h2 font-semibold">找不到路線</h2>
      <p v-if="r.plan" class="text-title">{{ routeLine }}</p>
      <ul v-if="issues.length" class="space-y-1">
        <li v-for="(w, i) in issues" :key="i" class="text-body font-semibold">{{ w.station }}：{{ w.text }}</li>
      </ul>

      <!-- 起訖站所有出口都在保養：給替代，由本人決定 -->
      <div v-for="s in blockedEnds" :key="'b' + s.kind" class="space-y-3 rounded-tp bg-red-50 p-3">
        <p class="text-body font-semibold">{{ s.st.station }}白天所有無障礙出口電梯都排定保養，實際時間以車站公告為準。</p>
        <button v-if="(s.kind === 'enter' || s.kind === 'exit') && s.alt" type="button" class="tp-btn" @click="useAlt(s.kind, s.alt.station)">
          <ArrowRightLeft class="size-6 shrink-0" aria-hidden="true" />
          <span>改{{ s.kind === "enter" ? "從" : "到" }}{{ s.alt.station }}（直線約 {{ s.alt.meters }} 公尺）</span>
        </button>
        <CallButton tel="0225363001" label="打給北捷客服確認" display="02-2536-3001" variant="outline" />
      </div>
    </section>

    <!-- 保養已自動避開（一行小註解）＋ 誠實說明還不知道的 -->
    <section v-if="r.plan" class="space-y-1 px-1" aria-label="資料說明">
      <p v-for="n in notes" :key="n" class="flex gap-2 text-body" data-testid="autofix-note"><Info class="mt-1 size-5 shrink-0 text-primary-800" aria-hidden="true" /><span>{{ n }}</span></p>
      <button v-if="notes.length" type="button" class="inline-flex min-h-16 items-center text-body font-semibold text-primary-800 underline" @click="revertAutoFix">改回原路線</button>
      <p class="text-body text-grayscale-700">還沒辦法確認：臨時故障（只看預排保養與異常公告，資料 {{ stamp(fetchedAt) }}）</p>
    </section>

    <!-- 出站之後：目的地是地點時才有 -->
    <section v-if="r.plan && dp" class="tp-card space-y-2" aria-labelledby="after-title">
      <h2 id="after-title" class="text-title font-semibold">出站之後・{{ dp.name }}</h2>
      <p v-if="exitInfo" class="text-body">{{ shortName(exitInfo.e.station) }}站 {{ fmtExit(exitInfo.e.exit) }} → 直線約 {{ exitInfo.meters }} 公尺</p>
      <template v-if="lm">
        <p v-if="lm.covered" class="text-body" data-testid="lastmile">
          附近：斜坡道 {{ lm.ramps }} 處<template v-if="lm.narrowest !== null">・人行道最窄 {{ lm.narrowest }} 公尺<template v-if="lm.narrow">（較窄）</template></template
          ><template v-else>・人行道未確認</template>・{{ lm.works ? `施工 ${lm.works} 處` : "沒有施工" }}（資料時間 {{ lm.dataTime }}）
        </p>
        <p v-else class="text-body" data-testid="lastmile">人行道、坡道：未確認</p>
        <p v-for="b in lm.blockers" :key="b.road" class="flex gap-1 text-body font-semibold text-danger">
          <TriangleAlert class="mt-1 size-5 shrink-0" aria-hidden="true" />{{ b.road }}施工到 {{ b.until }}，可能影響通行
        </p>
      </template>
      <p v-else-if="exitInfo" class="text-body" data-testid="lastmile">人行道、坡道：未確認</p>
      <div v-if="svc.length" class="flex flex-wrap gap-2 pt-1" data-testid="services">
        <button v-for="v in svc" :key="v.id" type="button" class="inline-flex min-h-16 items-center gap-2 rounded-tp border border-primary-600 bg-white px-4 py-1 text-left text-body font-semibold text-primary-800 active:bg-primary-50" @click="openExternal(v.url)">
          <ExternalLink class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ v.title }}<span v-if="v.loginRequired" class="block text-caption font-normal text-grayscale-700">要登入</span><span class="sr-only">（開啟網頁）</span></span>
        </button>
      </div>
    </section>

    <!-- 每一站怎麼走：預設收起，地圖也在裡面 -->
    <section v-if="r.plan" class="space-y-3">
      <h2 class="text-title font-semibold">
        <button type="button" class="tp-btn-outline justify-between" :aria-expanded="stepsOpen" aria-controls="steps-body" @click="stepsOpen = !stepsOpen">
          <span>每一站怎麼走</span>
          <ChevronDown class="size-6 shrink-0 transition-transform" :class="stepsOpen ? 'rotate-180' : ''" aria-hidden="true" />
        </button>
      </h2>
      <div v-if="stepsOpen" id="steps-body" class="space-y-3">
        <button v-if="speechOk" type="button" class="tp-btn-outline" @click="speakAll">
          <Volume2 class="size-6 shrink-0" aria-hidden="true" /><span>全部唸給我聽</span>
        </button>
          <ol class="space-y-3">
            <li v-for="(s, i) in steps" :key="i" class="tp-card flex gap-3" :class="'st' in s && s.st.blocked ? 'border-2 border-danger' : ''">
              <span class="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-500 text-body font-semibold text-on-primary" aria-hidden="true">{{ i + 1 }}</span>
              <div class="min-w-0 flex-1 space-y-1">
                <span class="sr-only">第 {{ i + 1 }} 步，</span>
                <template v-if="s.kind === 'enter' || s.kind === 'exit'">
                  <h3 class="text-title font-semibold">從{{ exitList(s.st) }}{{ s.kind === "enter" ? "進站" : "出站" }}</h3>
                  <p v-if="exitAlt(s.st) && !s.st.blocked" class="text-body">{{ exitAlt(s.st) }}</p>
                  <p v-if="s.st.onlyOne && !s.st.blocked" class="text-body font-semibold">這站只有 1 個無障礙出入口</p>
                  <ElevatorPath
                    v-if="s.fac?.path"
                    :path="s.fac.path"
                    :leaving="s.kind === 'exit'"
                    :station="s.st.station"
                    :exit-name="s.st.entrances[0] ? fmtExit(s.st.entrances[0].exit) : undefined"
                    :gate="s.fac.gate"
                    :cars="s.kind === 'enter' ? s.fac.wheelchairCars : null"
                    :speakable="speechOk"
                    @speak="speakText"
                  />
                  <p v-else-if="s.fac?.gate"><FacilityIcon kind="gate" :label="`無障礙閘門：${s.fac.gate}`" /></p>
                  <p v-if="s.kind === 'exit' && s.fac?.toilet"><FacilityIcon kind="toilet" :label="`無障礙廁所：${s.fac.toilet}`" /></p>
                  <p v-for="m in showExitWork(s) ? s.st.dayExitWork : []" :key="m.place" class="flex gap-1 text-body font-semibold text-danger">
                    <TriangleAlert class="mt-1 size-5 shrink-0" aria-hidden="true" />{{ s.st.station }} {{ fmtExit(m.place) }}電梯白天排定保養
                  </p>
                </template>
                <template v-else-if="s.kind === 'ride'">
                  <h3 class="flex flex-wrap items-center gap-2 text-title font-semibold">
                    <LineBadge :line="s.line" show-name />
                    往{{ shortName(s.toward) }}，坐 {{ s.stops }} 站到{{ shortName(s.to) }}
                  </h3>
                  <p v-if="s.cars" class="text-body"><span class="font-semibold">輪椅停靠：</span>{{ s.cars }}</p>
                  <p v-if="s.door" class="text-body"><span class="font-semibold">到{{ shortName(s.to) }}開門：</span>{{ s.door }}</p>
                  <p class="text-body text-grayscale-700">約 {{ s.min }} 分鐘</p>
                </template>
                <template v-else-if="s.kind === 'transfer'">
                  <h3 class="text-title font-semibold">{{ s.station }}：{{ s.sameLine ? "下車換搭支線的車" : `換搭${LINE_NAME[s.to]}` }}</h3>
                  <p v-if="!s.sameLine" class="text-body">{{ TRANSFER_HINT }}。步行約 {{ s.walkMin }} 分鐘。</p>
                </template>
                <template v-if="'st' in s">
                  <p v-for="m in s.st.dayPlatformWork" :key="'p' + m.place" class="flex gap-1 text-body font-semibold text-danger">
                    <TriangleAlert class="mt-1 size-5 shrink-0" aria-hidden="true" />{{ s.st.station }} {{ fmtExit(m.place) }}電梯白天排定保養
                  </p>
                  <p v-for="a in s.st.anomalies" :key="a.time" class="flex gap-1 text-body font-semibold text-danger">
                    <TriangleAlert class="mt-1 size-5 shrink-0" aria-hidden="true" />{{ a.text }}
                  </p>
                </template>
              </div>
              <button v-if="speechOk" type="button" class="tp-icon-btn -mt-2 -mr-2" :aria-label="`唸第 ${i + 1} 步`" @click="speakText(stepText(s))">
                <Volume2 class="size-7" aria-hidden="true" />
              </button>
            </li>
          </ol>
        <div v-if="mapPoints.length" class="space-y-2">
          <h3 class="tp-label">出入口位置（起＝出發站、終＝要去的站{{ dp ? "、地＝目的地" : "" }}）</h3>
          <div class="h-[40dvh] overflow-hidden rounded-card shadow-card" role="region" aria-label="路線地圖">
            <Map :key="r.origin + r.dest" :center="mapCenter" :zoom="13">
              <MapMarker v-for="e in mapPoints" :key="e.name + e.lng" :longitude="e.lng" :latitude="e.lat">
                <MarkerContent>
                  <div class="flex size-9 items-center justify-center rounded-full border-2 border-white text-caption font-semibold text-on-primary shadow" :class="e.station === r.origin ? 'bg-primary-500' : 'bg-secondary-500'">
                    {{ e.station === r.origin ? "起" : "終" }}
                  </div>
                </MarkerContent>
              </MapMarker>
              <MapMarker v-if="dp" :longitude="dp.lng" :latitude="dp.lat">
                <MarkerContent>
                  <div class="flex size-9 items-center justify-center rounded-full border-2 border-white bg-grayscale-900 text-caption font-semibold text-white shadow">地</div>
                </MarkerContent>
              </MapMarker>
              <MapFitPoints :points="[...mapPoints.map((e) => [e.lng, e.lat] as [number, number]), ...(dp ? [[dp.lng, dp.lat] as [number, number]] : [])]" />
              <MapControls position="bottom-right" show-zoom />
            </Map>
          </div>
        </div>
      </div>
    </section>

    <div v-if="!r.plan" class="tp-card text-body">這兩站之間找不到捷運路線。請回上一頁換一站。</div>
  </main>

  <div v-if="r?.plan" class="fixed inset-x-0 bottom-0 z-30 border-t border-grayscale-200 bg-white p-4" data-miss-ignore>
    <div class="mx-auto max-w-xl">
      <button v-if="today || S.active.value" type="button" class="tp-btn text-title" @click="depart">
        <RouteIcon class="size-6 shrink-0" aria-hidden="true" />
        <span>{{ S.active.value ? "回到路上的下一步" : "出發，一步一步帶我" }}</span>
      </button>
      <button v-else type="button" class="tp-btn text-title" @click="go('#/')">
        <span>已記在常走路線，當天再看</span>
      </button>
    </div>
  </div>
</template>
