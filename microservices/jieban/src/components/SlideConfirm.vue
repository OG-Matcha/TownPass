<script setup lang="ts">
// 高風險操作（撥號、通知家人求助）的滑動確認。城市通無障礙規範：滑過 95% 才觸發，右上角可取消。
// WCAG 2.5.7（拖曳動作）要求有不需拖曳的替代方式：
//  - 螢幕閱讀器／鍵盤：滑塊是一個 button，按 Enter／點兩下即確認（輔具使用者已經過「開啟這個視窗」的一次確認）
//  - 手抖滑不動：下方「改用按鈕確認」再按一次
import { ref } from "vue";
import { ChevronsRight, X } from "lucide-vue-next";

const props = defineProps<{ title: string; detail?: string; actionLabel: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const THRESHOLD = 0.95;
const track = ref<HTMLElement | null>(null);
const progress = ref(0); // 0–1
const showButton = ref(false);
let dragging = false;
let startX = 0;
let moved = false;

function width() {
  const t = track.value;
  if (!t) return 1;
  const thumb = t.querySelector<HTMLElement>("[data-thumb]");
  return Math.max(1, t.clientWidth - (thumb?.offsetWidth ?? 0));
}
function onDown(e: PointerEvent) {
  dragging = true;
  moved = false;
  startX = e.clientX;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function onMove(e: PointerEvent) {
  if (!dragging) return;
  const dx = e.clientX - startX;
  if (Math.abs(dx) > 4) moved = true;
  progress.value = Math.min(1, Math.max(0, dx / width()));
}
function onUp() {
  if (!dragging) return;
  dragging = false;
  if (progress.value >= THRESHOLD) emit("confirm");
  else progress.value = 0;
}
// 點一下（沒有拖）不觸發，只提示要滑；鍵盤 Enter／螢幕閱讀器的點兩下會走 click 且 detail === 0
function onClick(e: MouseEvent) {
  if (e.detail === 0) emit("confirm");
  else if (!moved) showButton.value = true;
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center" data-miss-ignore @click.self="emit('cancel')">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-title"
      class="w-full space-y-4 rounded-t-card bg-white p-5 shadow-card sm:mx-auto sm:max-w-xl sm:rounded-card"
    >
      <div class="flex items-start gap-3">
        <h2 id="slide-title" class="flex-1 text-title font-semibold">{{ props.title }}</h2>
        <button type="button" class="tp-icon-btn" aria-label="取消" @click="emit('cancel')">
          <X class="size-7" aria-hidden="true" />
        </button>
      </div>
      <p v-if="props.detail" class="text-body">{{ props.detail }}</p>

      <div ref="track" class="relative h-16 overflow-hidden rounded-full border border-grayscale-500 bg-grayscale-50">
        <div class="absolute inset-y-0 left-0 bg-primary-50" :style="{ width: `${progress * 100}%` }" aria-hidden="true" />
        <span class="absolute inset-0 flex items-center justify-center pl-16 text-h3 font-semibold text-grayscale-700" aria-hidden="true">
          往右滑到底：{{ props.actionLabel }}
        </span>
        <button
          type="button"
          data-thumb
          class="absolute top-0 left-0 flex size-16 touch-none items-center justify-center rounded-full bg-primary-500 text-on-primary"
          :style="{ transform: `translateX(${progress * width()}px)` }"
          :aria-label="`確認${props.actionLabel}`"
          @pointerdown="onDown"
          @pointermove="onMove"
          @pointerup="onUp"
          @pointercancel="onUp"
          @click="onClick"
        >
          <ChevronsRight class="size-8" aria-hidden="true" />
        </button>
      </div>

      <p v-if="showButton" class="text-body font-semibold">請按住圓形按鈕往右滑到底。滑不動的話，可以改按下面的按鈕。</p>
      <button v-if="showButton" type="button" class="tp-btn-outline" @click="emit('confirm')">改用按鈕確認：{{ props.actionLabel }}</button>
      <button v-else type="button" class="tp-link" @click="showButton = true">滑不動？改用按鈕確認</button>
    </div>
  </div>
</template>
