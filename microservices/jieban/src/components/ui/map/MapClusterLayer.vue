<script setup lang="ts">
import { useMapClusterLayer } from "./composables/useMapClusterLayer";

const props = withDefaults(
  defineProps<{
    data: string | GeoJSON.FeatureCollection<GeoJSON.Point>;
    clusterMaxZoom?: number;
    clusterRadius?: number;
    clusterColors?: [string, string, string];
    clusterThresholds?: [number, number];
    pointColor?: string;
    onPointClick?: (
      feature: GeoJSON.Feature<GeoJSON.Point>,
      coordinates: [number, number],
    ) => void;
    onClusterClick?: (
      clusterId: number,
      coordinates: [number, number],
      pointCount: number,
    ) => void;
  }>(),
  {
    clusterMaxZoom: 14,
    clusterRadius: 50,
    clusterColors: () => ["#22c55e", "#eab308", "#ef4444"],
    clusterThresholds: () => [100, 750],
    pointColor: "#3b82f6",
  },
);

useMapClusterLayer(props);
</script>

<template>
  <div v-if="false" />
</template>
