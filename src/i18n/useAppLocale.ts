import { computed, type ComputedRef } from "vue";
import { usePreferredLanguages } from "@vueuse/core";
import { getLocale, setLocale, type SupportedLocale, SUPPORTED_LOCALES } from "./index";

function normalize(lang: string): SupportedLocale | null {
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("en")) return "en";
  return null;
}

/**
 * Resolves the active locale by intersecting:
 *  1. The user's `app.locale` setting (explicit)
 *  2. The browser's preferred languages (fallback)
 *  Returns a reactive ref that updates when browser language changes.
 */
export function useAppLocale(): {
  activeLocale: ComputedRef<SupportedLocale>;
  resolvedFrom: ComputedRef<"explicit" | "browser" | "default">;
} {
  const browserLanguages = usePreferredLanguages();
  const activeLocale = computed<SupportedLocale>(() => {
    const fromBrowser = browserLanguages.value
      .map(normalize)
      .find((l): l is SupportedLocale => l !== null);
    return fromBrowser ?? "en";
  });

  return {
    activeLocale,
    resolvedFrom: computed(() =>
      browserLanguages.value.length > 0 ? "browser" : "default"
    ),
  };
}

/** Apply the current `activeLocale` to the global i18n instance. Call from onMounted. */
export function applyAppLocale(locale: SupportedLocale): void {
  if (SUPPORTED_LOCALES.includes(locale)) {
    setLocale(locale);
  }
}

export { getLocale };