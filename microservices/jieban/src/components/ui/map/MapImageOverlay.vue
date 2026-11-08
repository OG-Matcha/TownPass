<script setup lang="ts">
import { useMapImageOverlay } from "./composables/useMapImageOverlay";

const props = withDefaults(
  defineProps<{
    id?: string;
    url: string;
    coordinates: [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    opacity?: number;
  }>(),
  {
    opacity: 1,
  },
);

useMapImageOverlay(props);
</script>

<template>
  <div v-if="false" />
</template>
