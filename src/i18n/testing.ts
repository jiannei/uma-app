import { createI18n } from "vue-i18n";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import type { SupportedLocale } from "./index";

/**
 * Create a fresh i18n instance for unit tests.
 * Use: `mount(Cmp, { global: { plugins: [createTestingI18n('zh')] } })`
 */
export function createTestingI18n(locale: SupportedLocale = "en") {
  return createI18n<[typeof en, typeof zh], SupportedLocale>({
    legacy: false,
    locale,
    fallbackLocale: "en",
    messages: { en, zh },
    // Tests should fail loudly on missing keys, not silently
    missingWarn: true,
    fallbackWarn: true,
    silentTranslationWarn: false,
  });
}