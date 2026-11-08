<script setup lang="ts">
// 外殼：依 hash 路由切換畫面（首頁＝常走路線＋從哪站到哪站 → 選站 → 結果 → 路上一步一步；家人頁另一個入口）。
// 資料建置時抓好打包（data.taipei 不開 CORS、評審可能斷網）。
import { warmIntent } from "@/lib/intent";
import { onMounted, onUnmounted, ref } from "vue";
import { go, replace, route } from "@/lib/router";
import * as S from "@/lib/tripSession";
import { active } from "@/lib/tripSession";
import { t } from "@/lib/i18n";
import { syncWithApp } from "@/lib/appSettings";
import { stopSpeaking } from "@/lib/speech";
import { watch } from "vue";

// 換頁、離開服務（切到別的 App、關掉頁面）：正在念的話立刻停，不會念著別頁的內容
watch(() => route.value.name, () => stopSpeaking());
const stopWhenHidden = () => document.visibilityState === "hidden" && stopSpeaking();
document.addEventListener("visibilitychange", stopWhenHidden);
window.addEventListener("pagehide", stopSpeaking);

// 行程還沒結束、使用者跳出服務又回來：打開時直接回到路上那一頁（首頁不放「繼續剛才的路線」）。
// 只在剛打開時判斷；路上主動按返回回首頁不會被拉回去。
if (active.value && route.value.name === "home") replace("#/trip");
import { fontLevel } from "@/lib/settings";
import { watchMissTaps } from "@/lib/missTap";
import { loadData } from "@/lib/planner";
import { loadPlaces } from "@/lib/places";
import HomeView from "@/views/HomeView.vue";
import GoView from "@/views/GoView.vue";
import OftenView from "@/views/OftenView.vue";
import StationPicker from "@/views/StationPicker.vue";
import ResultView from "@/views/ResultView.vue";
import TripView from "@/views/TripView.vue";
import FamilyView from "@/FamilyView.vue";
import SnackBar from "@/components/SnackBar.vue";

onMounted(() => {
  void syncWithApp();
  loadData();
  loadPlaces();
  // 裝置端語意模型：畫面先出來，閒置時才在背景載入（約 10 秒）；沒載好之前語音指令走規則
  const warm = () => void warmIntent().catch(() => {});
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 3000 });
  else setTimeout(warm, 1500);
});

// 按偏偵測：先問再放大；說「不用」這次就不再問；已經最大就不問
const askBigger = ref(false);
let declinedBigger = false;
try {
  declinedBigger = sessionStorage.getItem("declinedBigger") === "1";
} catch {}
const stopMissTaps = watchMissTaps(() => {
  if (!declinedBigger && fontLevel.value !== "xlarge") askBigger.value = true;
});
onUnmounted(stopMissTaps);
function acceptBigger() {
  fontLevel.value = fontLevel.value === "normal" ? "large" : "xlarge";
  askBigger.value = false;
}
// 已有進行中的行程、又按了另一條路線的「出發」：問一次，永遠只有一趟
async function switchYes() {
  if (await S.confirmSwitch()) go("#/trip");
}
function switchNo() {
  S.cancelSwitch();
  go("#/trip");
}
function declineBigger() {
  askBigger.value = false;
  declinedBigger = true;
  try {
    sessionStorage.setItem("declinedBigger", "1");
  } catch {}
}
</script>

<template>
  <FamilyView v-if="route.name === 'family'" :id="route.id" />
  <div v-else class="mx-auto min-h-dvh max-w-xl bg-background">
    <HomeView v-if="route.name === 'home'" />
    <GoView v-else-if="route.name === 'go'" />
    <OftenView v-else-if="route.name === 'often'" />
    <StationPicker v-else-if="route.name === 'pick'" :key="route.field" :field="route.field" />
    <ResultView v-else-if="route.name === 'result'" />
    <TripView v-else-if="route.name === 'trip'" />
  </div>

  <!-- 不搶焦點、不自動消失，固定在底部按鈕上方 -->
  <div class="fixed inset-x-0 z-40 px-4" :class="route.name === 'trip' ? 'bottom-64' : 'bottom-28'" data-miss-ignore>
    <div role="status" aria-live="polite" class="mx-auto max-w-xl">
      <div v-if="askBigger && fontLevel !== 'xlarge'" class="tp-card space-y-4 border border-primary-600">
        <p class="text-h3 font-semibold">看起來不太好按，要不要把字和按鈕放大一點？</p>
        <div class="grid grid-cols-2 gap-4">
          <button type="button" class="tp-btn" @click="acceptBigger">放大</button>
          <button type="button" class="tp-btn-outline" @click="declineBigger">不用</button>
        </div>
      </div>
    </div>
  </div>
  <div v-if="S.pendingSwitch.value" class="fixed inset-0 z-50 flex items-end bg-black/50" data-miss-ignore data-testid="switch-trip">
    <div role="dialog" aria-modal="true" aria-labelledby="switch-title" class="tp-sheet">
      <div class="tp-sheet-handle" aria-hidden="true" />
      <h2 id="switch-title" class="text-h3 font-semibold">{{ t.switchTitle }}</h2>
      <button type="button" class="tp-btn" data-testid="switch-yes" @click="switchYes">{{ t.switchYes }}</button>
      <button type="button" class="tp-btn-outline" autofocus data-testid="switch-no" @click="switchNo">{{ t.switchNo }}</button>
    </div>
  </div>
  <SnackBar />
</template>
