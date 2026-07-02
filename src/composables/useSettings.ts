// src/composables/useSettings.ts — Single owner of "the value of
// <field> right now" on the frontend side.
//
// One instance per webview (main / robot / bubble). Each instance:
//   1. On mount, pulls the current snapshot via `get_settings`.
//   2. Subscribes to the 5 settings-change events via
//      `useTauriEvents` and patches the local ref so subscribers
//      (templates, watches) react.
//   3. Exposes mutator helpers that call into the matching Tauri
//      command — no caller can bypass the Rust owner.
//
// The 6 event subscription blocks that used to live here (one per
// field) collapsed into a single `useTauriEvents<EventPayloadMap>(...)`
// call after the helper landed — see composables/useTauriEvents.ts.
// `LANGUAGE_CHANGE` is now a real subscriber alongside the others
// (it was previously half-dead; the comment that called it out is
// gone because the bug it described is gone).
//
// This is the frontend counterpart to the `SettingsStore` deepening.
// The two App.vue handlers that used to write plugin-store directly
// (`setLanguage`, `toggleAutoStart`) are gone; all mutations go
// through `store.set_*` / `store.toggle_*` on the Rust side, which
// keeps in-memory state, plugin-store persistence, and event
// broadcast aligned without call-site coordination.

import { ref, onMounted, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";

import { EVENTS } from "@/types/events";
import { DEFAULT_SETTINGS, type Settings } from "@/types/settings";
import {
  EventPayloadMap,
  useTauriEvents,
} from "@/composables/useTauriEvents";

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

  onMounted(async () => {
    try {
      settings.value = await invoke<Settings>("get_settings");
    } catch {
      // Stick with defaults — same fallback Rust uses on
      // plugin-store load failure.
    }
  });

  // Patch the local ref whenever the Rust owner broadcasts a change.
  // The list of subscribed events IS the documentation of which
  // settings this composable is responsible for — adding a new
  // setting means adding one entry here (and the helper's type
  // signature ensures the handler's payload type matches the
  // event's wire-string key).
  useTauriEvents<EventPayloadMap>({
    [EVENTS.THEME_CHANGE]: ({ theme }) => {
      settings.value.theme = theme;
    },
    [EVENTS.DND_CHANGE]: ({ dnd }) => {
      settings.value.dnd = dnd;
    },
    [EVENTS.SOUND_CHANGE]: ({ sound_enabled }) => {
      settings.value.sound_enabled = sound_enabled;
    },
    [EVENTS.LANGUAGE_CHANGE]: ({ language }) => {
      settings.value.language = language;
    },
    [EVENTS.AUTO_START_CHANGE]: ({ auto_start }) => {
      settings.value.auto_start = auto_start;
    },
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
