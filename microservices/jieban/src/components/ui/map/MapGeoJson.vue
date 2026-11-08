<script setup lang="ts">
import type { FeatureCollection, Feature, Geometry } from "geojson";
import type { FitBoundsOptions } from "maplibre-gl";
import {
  useMapGeoJson,
  type GeoJsonLayerStyle,
} from "./composables/useMapGeoJson";

export type { GeoJsonLayerStyle };

const props = withDefaults(
  defineProps<{
    id?: string;
    data: FeatureCollection | Feature<Geometry>;
    layerType?: "fill" | "line" | "circle" | "symbol";
    style?: GeoJsonLayerStyle;
    fitBounds?: boolean;
    fitBoundsOptions?: FitBoundsOptions;
    interactive?: boolean;
  }>(),
  {
    layerType: "fill",
    fitBounds: false,
    interactive: true,
  },
);

const emit = defineEmits<{
  click: [feature: Feature];
  mouseEnter: [feature: Feature];
  mouseLeave: [];
}>();

useMapGeoJson({
  get id() {
    return props.id;
  },
  get data() {
    return props.data;
  },
  get layerType() {
    return props.layerType;
  },
  get style() {
    return props.style;
  },
  get fitBounds() {
    return props.fitBounds;
  },
  get fitBoundsOptions() {
    return props.fitBoundsOptions;
  },
  get interactive() {
    return props.interactive;
  },
  onClick: (feature) => emit("click", feature),
  onMouseEnter: (feature) => emit("mouseEnter", feature),
  onMouseLeave: () => emit("mouseLeave"),
});
</script>

<template>
  <div v-if="false" />
</template>
