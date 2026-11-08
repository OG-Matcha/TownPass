import { ref, computed, onMounted, onUnmounted, type Ref } from "vue";

type Theme = "light" | "dark";

function getDocumentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  return null;
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useResolvedTheme(
  themeProp?: Ref<Theme | undefined>,
): Ref<Theme> {
  const detectedTheme = ref<Theme>(getDocumentTheme() ?? getSystemTheme());

  onMounted(() => {
    if (themeProp?.value) return;

    const observer = new MutationObserver(() => {
      const docTheme = getDocumentTheme();
      if (docTheme) {
        detectedTheme.value = docTheme;
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = (e: MediaQueryListEvent) => {
      if (!getDocumentTheme()) {
        detectedTheme.value = e.matches ? "dark" : "light";
      }
    };
    mediaQuery.addEventListener("change", handleSystemChange);

    onUnmounted(() => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleSystemChange);
    });
  });

  return computed(() => themeProp?.value ?? detectedTheme.value);
}
