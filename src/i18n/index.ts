import { createI18n } from "vue-i18n";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export type SupportedLocale = "en" | "zh";

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["en", "zh"] as const;

export const i18n = createI18n<[typeof en, typeof zh], SupportedLocale>({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages: { en, zh },
  // Keep warnings in dev for missing keys; silent in prod
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

export function setLocale(locale: SupportedLocale): void {
  i18n.global.locale = locale;
}

export function getLocale(): SupportedLocale {
  return i18n.global.locale as SupportedLocale;
}