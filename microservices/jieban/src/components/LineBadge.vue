<script setup lang="ts">
// 路線標籤：官方路線色＋英文代碼（顏色與代碼是事實資訊；不使用北捷標誌圖案）。
import { computed } from "vue";
import { LINE_COLOR } from "@/lib/planner";
import { LINE_NAME, type Line } from "@/lib/route";

const props = defineProps<{ line: Line; no?: number | string; showName?: boolean }>();
const DARK_TEXT: Line[] = ["O", "Y", "BR"]; // 淺色底用深字，對比 ≥ 4.5:1
const fg = computed(() => (DARK_TEXT.includes(props.line) ? "#171b1d" : "#ffffff"));
const code = computed(() => `${props.line}${props.no != null ? " " + String(props.no).padStart(2, "0") : ""}`);
</script>

<template>
  <span class="inline-flex items-center gap-1.5 align-middle">
    <span
      class="inline-flex min-h-7 min-w-9 items-center justify-center rounded-md border-2 border-white px-1.5 text-body font-bold tabular-nums shadow-[0_0_0_1px_#475259]"
      :style="{ background: LINE_COLOR[line], color: fg }"
      :aria-label="`${LINE_NAME[line]}${no != null ? '，站號 ' + no : ''}`"
      role="img"
    >{{ code }}</span>
    <span v-if="showName" class="text-body font-semibold text-grayscale-900">{{ LINE_NAME[line] }}</span>
  </span>
</template>
