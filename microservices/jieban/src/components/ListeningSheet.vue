<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    state: "listening" | "thinking" | "heard" | "error";
    transcript: string;
    hint: string;
    lang?: "zh" | "id";
  }>(),
  { lang: "zh" },
);
defineEmits<{ cancel: [] }>();

const LABELS = {
  zh: { listening: "正在聽", thinking: "辨識中", heard: "聽到了", error: "沒聽清楚", heardPre: "聽到：", cancel: "取消", mic: "麥克風" },
  id: { listening: "Mendengarkan", thinking: "Memproses", heard: "Terdengar", error: "Tidak jelas", heardPre: "Terdengar: ", cancel: "Batal", mic: "Mikrofon" },
} as const;

const t = computed(() => LABELS[props.lang]);
const label = computed(() => t.value[props.state]);
const line = computed(() => (props.transcript ? `${t.value.heardPre}${props.transcript}` : ""));
const pulsing = computed(() => props.state === "listening");
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-end bg-black/40" data-miss-ignore role="dialog" aria-modal="true" :aria-label="label">
      <div class="tp-sheet text-grayscale-800 text-center">
        <div class="tp-sheet-handle" />
        <div class="relative mx-auto flex size-28 items-center justify-center" aria-hidden="true">
          <span v-if="pulsing" class="ls-ring bg-primary-500 absolute inset-0 rounded-full motion-reduce:hidden" />
          <span
            class="bg-primary-500 text-on-primary relative flex size-24 items-center justify-center rounded-full"
            :class="state === 'error' ? 'ring-4 ring-red-700' : ''"
          >
            <svg viewBox="0 0 24 24" class="size-12" fill="currentColor" focusable="false">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
            </svg>
          </span>
        </div>
        <p class="text-h2 text-grayscale-800 font-bold" :class="state === 'error' ? 'text-red-700' : ''">{{ label }}</p>
        <div role="status" aria-live="assertive" class="text-h2 text-grayscale-800 min-h-[3.5rem] font-semibold break-words">
          {{ line }}
        </div>
        <p class="text-title text-grayscale-800">{{ hint }}</p>
        <button type="button" class="tp-btn-outline h-16" @click="$emit('cancel')">{{ t.cancel }}</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ls-ring {
  animation: ls-pulse 1.2s ease-out infinite;
}
@keyframes ls-pulse {
  from {
    transform: scale(0.86);
    opacity: 0.55;
  }
  to {
    transform: scale(1.25);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ls-ring {
    animation: none;
  }
}
</style>
