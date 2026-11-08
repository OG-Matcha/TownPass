<script setup lang="ts">
// 三種狀態：已確認（官方資料有）／需確認（資料沒有或不確定）／不符合（已知不符條件）。
// 一定同時有圖示＋文字，不只靠顏色（灰階、色覺差異、讀屏都看得懂）。
import { CircleCheck, CircleHelp, CircleX } from "lucide-vue-next";

const props = defineProps<{ kind: "ok" | "check" | "no" }>();
const META = {
  ok: { icon: CircleCheck, word: "已確認", cls: "text-ok" },
  check: { icon: CircleHelp, word: "需確認", cls: "text-secondary-800" },
  no: { icon: CircleX, word: "不符合", cls: "text-danger" },
} as const;
</script>

<template>
  <li class="flex items-start gap-2 text-body">
    <component :is="META[props.kind].icon" class="mt-0.5 size-5 shrink-0" :class="META[props.kind].cls" aria-hidden="true" />
    <span><strong :class="META[props.kind].cls">{{ META[props.kind].word }}</strong>：<slot /></span>
  </li>
</template>
