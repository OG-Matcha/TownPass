import { inject } from "vue";
import { MAP_KEY, type MapContextValue } from "../constants";

export { type MapContextValue };

export function useMap(): MapContextValue {
  const context = inject(MAP_KEY);
  if (!context) {
    throw new Error("useMap must be used within a Map component");
  }
  return context;
}
