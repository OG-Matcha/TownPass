<script setup lang="ts">
import type { FitBoundsOptions } from "maplibre-gl";
import { useMapRoute } from "./composables/useMapRoute";

const props = withDefaults(
  defineProps<{
    id?: string;
    coordinates: [number, number][];
    color?: string;
    width?: number;
    opacity?: number;
    dashArray?: [number, number];
    animated?: boolean;
    animationDuration?: number;
    fitBounds?: boolean;
    fitBoundsOptions?: FitBoundsOptions;
    onClick?: () => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    interactive?: boolean;
  }>(),
  {
    color: "#4285F4",
    width: 3,
    opacity: 0.8,
    animated: false,
    animationDuration: 2000,
    fitBounds: false,
    interactive: true,
  },
);

useMapRoute(props);
</script>

<template>
  <div v-if="false" />
</template>
