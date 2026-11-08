<script setup lang="ts">
import { dismissSnack, runUndo, snack } from "@/lib/snackbar";
import { X } from "lucide-vue-next";
</script>

<template>
  <!-- role=status：讀屏會念出結果；不搶焦點 -->
  <div class="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" :style="{ bottom: `var(--snack-bottom, 112px)` }" role="status" aria-live="polite" data-miss-ignore>
    <div
      v-if="snack"
      :key="snack.id"
      class="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-tp bg-grayscale-900 py-1 pr-1 pl-4 text-body text-white shadow-lg"
    >
      <p class="flex-1 py-3 font-semibold">{{ snack.text }}</p>
      <button v-if="snack.undo" type="button" class="min-h-16 rounded-tp px-4 font-semibold text-secondary-500 underline underline-offset-4" @click="runUndo">
        復原
      </button>
      <button type="button" class="flex size-16 items-center justify-center rounded-tp" aria-label="關閉提示" @click="dismissSnack">
        <X class="size-6" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
