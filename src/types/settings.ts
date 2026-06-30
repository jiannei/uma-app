// src/types/settings.ts — Shared Settings shape used by the
// `useSettings()` composable and every component that reads settings.
//
// Mirror of the Rust `Settings` struct in
// `src-tauri/src/settings_store.rs`. Field names are camelCase to
// match the JSON the Rust side serializes via serde (which keeps
// snake_case for the struct fields but the frontend invocations
// alias `enabled` → `dnd` etc.).

export interface Settings {
  theme: string;
  dnd: boolean;
  mini_mode: boolean;
  sound_enabled: boolean;
  auto_start: boolean;
  language: string;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "uma",
  dnd: false,
  mini_mode: false,
  sound_enabled: true,
  auto_start: false,
  language: "en",
};