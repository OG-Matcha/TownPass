<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: string;
}>();
</script>

<template>
  <div :class="cn('relative cursor-pointer', props.class)">
    <slot>
      <!-- Default marker icon -->
      <div
        class="relative h-4 w-4 rounded-full border-2 border-white bg-blue-500 shadow-lg"
      />
    </slot>
  </div>
</template>
