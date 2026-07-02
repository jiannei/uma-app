// src/composables/useSettings.ts — Single owner of "the value of
// <field> right now" on the frontend side.
//
// One instance per webview (main / robot / bubble). Each instance:
//   1. On mount, pulls the current snapshot via `get_settings`.
//   2. Subscribes to the 5 settings-change events via
//      `useTauriEvents` and patches the local ref so subscribers
//      (templates, watches) react.
//   3. Exposes a single mutator `update<K>(field, value)` that
//      dispatches into the canonical Rust `set_setting` command
//      — no caller can bypass the Rust owner, and there is no
//      per-field Tauri command surface to maintain.
//
// Toggle semantics live at the TS layer: `useSettings` does not
// provide `toggleDnd` etc. Callers that want a toggle read the
// current value, compute the new value, and call `update`:
//
//     const { settings, update } = useSettings();
//     await update("dnd", !settings.value.dnd);
//
// The frontend counterpart of the SettingsStore deepening (the
// Rust `SettingsStore::apply(Change)` is the single entry point;
// this composable is the single TS entry point). Both App.vue and
// BubbleShellRoot use it; `bubble_permission_auto_close_seconds`
// (formerly a `useStorage` bypass) now flows through the same
// pipeline.

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
  /**
   * Apply a single field update. Returns when the Rust owner has
   * validated, persisted, and emitted; rejects if validation fails
   * or persistence fails (the in-memory state and event broadcast
   * are skipped in either case, so subscribers never see a
   * non-durable value).
   */
  update: <K extends keyof Settings>(field: K, value: Settings[K]) => Promise<void>;
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
    [EVENTS.BUBBLE_AUTO_CLOSE_CHANGE]: ({ bubble_permission_auto_close_seconds }) => {
      settings.value.bubble_permission_auto_close_seconds = bubble_permission_auto_close_seconds;
    },
  });

  return {
    settings,
    update: async (field, value) => {
      await invoke("set_setting", { field, value });
    },
  };
}
