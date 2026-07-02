// src/types/settings.ts — Frontend Settings type re-export + runtime defaults.
//
// The `Settings` *type* is generated from the Rust `Settings` struct
// via `cargo run --bin export-settings-ts` (output:
// `src/types/generated/settings.ts`). Do NOT hand-maintain a parallel
// `Settings` interface here — drift between Rust and TS is a class of
// bug the ts-rs setup is designed to eliminate.
//
// `DEFAULT_SETTINGS` is a runtime *value* (a valid `Settings`
// instance) and stays hand-maintained. The defaults mirror the Rust
// `Settings::default()` impl in `src-tauri/src/settings_store.rs`.
// `useSettings()` uses this as the initial reactive value before the
// async `get_settings` invoke resolves; it also falls back to it if
// the invoke throws.
//
// Drift discipline: any new field on the Rust struct surfaces as a
// new key in the generated `Settings` type. Adding a new key here
// (with a default) without adding it Rust-side is silently fine for
// the type (extra optional property), but it WILL drift the other
// direction — a Rust field with no TS default is undefined on the
// frontend until `get_settings` populates it. The existing
// `bubble_permission_auto_close_seconds` is the only such field and
// it's gated on its own dedicated UX, not the catch-all defaults.

export type { Settings } from "./generated/settings";
import type { Settings as GeneratedSettings } from "./generated/settings";

export const DEFAULT_SETTINGS: GeneratedSettings = {
  theme: "uma",
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
  language: "en",
  bubble_permission_auto_close_seconds: 0,
};
