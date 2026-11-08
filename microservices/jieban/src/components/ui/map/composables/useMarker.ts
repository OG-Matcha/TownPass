import { inject } from "vue";
import { MARKER_KEY, type MarkerContextValue } from "../constants";

export { type MarkerContextValue };

export function useMarkerContext(): MarkerContextValue {
  const context = inject(MARKER_KEY);
  if (!context) {
    throw new Error("Marker components must be used within MapMarker");
  }
  return context;
}
