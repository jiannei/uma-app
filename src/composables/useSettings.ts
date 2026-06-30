// src/composables/useSettings.ts — Single owner of "the value of
// <field> right now" on the frontend side.
//
// One instance per webview (main / robot / bubble). Each instance:
//   1. On mount, pulls the current snapshot via `get_settings`.
//   2. Subscribes to the 6 settings-change events and patches the
//      local ref so subscribers (templates, watches) react.
//   3. Exposes mutator helpers that call into the matching Tauri
//      command — no caller can bypass the Rust owner.
//
// This is the frontend counterpart to the `SettingsStore` deepening.
// The two App.vue handlers that used to write plugin-store directly
// (`setLanguage`, `toggleAutoStart`) are gone; all mutations go
// through `store.set_*` / `store.toggle_*` on the Rust side, which
// keeps in-memory state, plugin-store persistence, and event
// broadcast aligned without call-site coordination.

import { ref, onMounted, onUnmounted, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { EVENTS } from "@/types/events";
import { DEFAULT_SETTINGS, type Settings } from "@/types/settings";

export interface UseSettingsReturn {
  settings: Ref<Settings>;
  setTheme: (theme: string) => Promise<void>;
  setDnd: (enabled: boolean) => Promise<void>;
  setSound: (enabled: boolean) => Promise<void>;
  setLanguage: (language: string) => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  toggleDnd: () => Promise<void>;
  toggleSound: () => Promise<void>;
  toggleAutoStart: () => Promise<void>;
}

export function useSettings(): UseSettingsReturn {
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS });
  const unlisteners: UnlistenFn[] = [];

  onMounted(async () => {
    // Pull initial snapshot.
    try {
      settings.value = await invoke<Settings>("get_settings");
    } catch {
      // Stick with defaults — same fallback Rust uses on
      // plugin-store load failure.
    }

    // Subscribe to per-field change events.
    unlisteners.push(
      await listen<{ theme: string }>(EVENTS.THEME_CHANGE, (e) => {
        if (e.payload?.theme) settings.value.theme = e.payload.theme;
      }),
    );
    unlisteners.push(
      await listen<{ dnd: boolean }>(EVENTS.DND_CHANGE, (e) => {
        if (typeof e.payload?.dnd === "boolean") settings.value.dnd = e.payload.dnd;
      }),
    );
    unlisteners.push(
      await listen<{ sound_enabled: boolean }>(
        EVENTS.SOUND_CHANGE,
        (e) => {
          if (typeof e.payload?.sound_enabled === "boolean")
            settings.value.sound_enabled = e.payload.sound_enabled;
        },
      ),
    );
    // LANGUAGE_CHANGE is half-dead (no TS listener was wired before)
    // — settings_store.rs still emits it for compatibility. Keep the
    // subscription so the frontend stays in sync if Rust emits.
    unlisteners.push(
      await listen<{ language: string }>(EVENTS.LANGUAGE_CHANGE, (e) => {
        if (e.payload?.language) settings.value.language = e.payload.language;
      }),
    );
    unlisteners.push(
      await listen<{ auto_start: boolean }>(
        EVENTS.AUTO_START_CHANGE,
        (e) => {
          if (typeof e.payload?.auto_start === "boolean")
            settings.value.auto_start = e.payload.auto_start;
        },
      ),
    );
  });

  onUnmounted(() => {
    for (const u of unlisteners) u();
    unlisteners.length = 0;
  });

  return {
    settings,
    setTheme: (theme) => invoke("set_theme", { theme }),
    setDnd: (enabled) => invoke("set_dnd", { enabled }),
    setSound: (enabled) => invoke("set_sound", { enabled }),
    setLanguage: (language) => invoke("set_language", { language }),
    setAutoStart: (enabled) => invoke("set_auto_start", { enabled }),
    toggleDnd: () => invoke("toggle_dnd"),
    toggleSound: () => invoke("toggle_sound"),
    toggleAutoStart: () => invoke("toggle_auto_start"),
  };
}