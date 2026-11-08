<script setup lang="ts">
// 設施圖示：圖示旁一律有文字，圖示本身不單獨出現。
import { computed, type Component } from "vue";
import { Baby, Construction, DoorOpen, Headset, Toilet, TrendingUp, ArrowUpDown } from "lucide-vue-next";

export type FacilityKind = "toilet" | "elevator" | "ramp" | "nursing" | "info" | "gate" | "slope" | "construction";
const props = defineProps<{ kind: FacilityKind; label?: string; tone?: "normal" | "warn" }>();
const META: Record<FacilityKind, { icon: Component; text: string }> = {
  toilet: { icon: Toilet, text: "無障礙廁所" },
  elevator: { icon: ArrowUpDown, text: "電梯" },
  ramp: { icon: TrendingUp, text: "坡道" },
  slope: { icon: TrendingUp, text: "斜坡道" },
  nursing: { icon: Baby, text: "哺集乳室" },
  info: { icon: Headset, text: "詢問處" },
  gate: { icon: DoorOpen, text: "無障礙閘門" },
  construction: { icon: Construction, text: "施工中" },
};
const m = computed(() => META[props.kind]);
</script>

<template>
  <span class="inline-flex min-h-12 items-center gap-2 text-body font-semibold" :class="tone === 'warn' ? 'text-danger' : 'text-grayscale-900'">
    <component :is="m.icon" class="size-7 shrink-0" :class="tone === 'warn' ? '' : 'text-primary-800'" aria-hidden="true" />
    <span>{{ label ?? m.text }}</span>
  </span>
</template>
