<script setup lang="ts">
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    class?: string;
    position?: "top" | "bottom";
  }>(),
  {
    position: "top",
  },
);

const positionClasses = {
  top: "bottom-full mb-1",
  bottom: "top-full mt-1",
};
</script>

<template>
  <div
    :class="
      cn(
        'absolute left-1/2 -translate-x-1/2 whitespace-nowrap',
        'text-[10px] font-medium text-foreground',
        positionClasses[position],
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
