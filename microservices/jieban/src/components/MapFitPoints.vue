<script setup lang="ts">
// 放在 <Map> 裡：地圖載入後自動縮放到包含所有點（起點、終點出入口）
import { watch } from "vue";
import { LngLatBounds } from "maplibre-gl";
import { useMap } from "@/components/ui/map/composables/useMap";

const props = defineProps<{ points: [number, number][] }>();
const { map, isLoaded } = useMap();

watch(
  [isLoaded, () => props.points],
  () => {
    const m = map.value;
    if (!m || !isLoaded.value || !props.points.length) return;
    const b = new LngLatBounds(props.points[0], props.points[0]);
    for (const p of props.points) b.extend(p);
    m.fitBounds(b, { padding: 56, maxZoom: 16, duration: 0 });
  },
  { immediate: true },
);
</script>

<template><slot /></template>
