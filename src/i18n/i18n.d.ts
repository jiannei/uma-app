import en from "./locales/en.json";

// Type-safe i18n keys: extends DefineLocaleMessage so t() checks key existence
type EnMessages = typeof en;

declare module "vue-i18n" {
  export interface DefineLocaleMessage extends EnMessages {}
}

export {};