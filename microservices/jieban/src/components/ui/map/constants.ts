import type { InjectionKey, ShallowRef, Ref } from "vue";
import type { Map, Marker } from "maplibre-gl";

export interface MapContextValue {
  map: ShallowRef<Map | null>;
  isLoaded: Ref<boolean>;
  isStyleLoaded: Ref<boolean>;
  hasRendered: Ref<boolean>;
}

export interface MarkerContextValue {
  marker: ShallowRef<Marker | null>;
  map: ShallowRef<Map | null>;
  isReady: Ref<boolean>;
}

export const MAP_KEY: InjectionKey<MapContextValue> = Symbol("map");
export const MARKER_KEY: InjectionKey<MarkerContextValue> = Symbol("marker");
