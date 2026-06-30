// src/robot/composables/useThemeAssets.ts — Owns the ThemeManager
// singleton + theme registration literals + theme change handlers.
//
// What lives here:
//   - The `ThemeManager` instance (singleton per window)
//   - Registration of the two shipped themes (uma, calico) with their
//     viewBox / hitBox / objectScale / state→file tables
//   - `onThemeIdChanged(id)` — user-driven theme switch (settings UI,
//     tray menu). Fetches theme.json from the Vite publicDir.
//   - `onThemeUpdated(id)` — dev-only path: theme.json on disk was
//     rewritten by the dev panel Save. Invokes `theme_load` IPC.
//   - `loadInitial()` — initial mount: read settings.theme_id,
//     fetch its manifest, setTheme + applyTheme.
//   - `watch(settings.value.theme)` — re-applies on settings change.
//
// What does NOT live here:
//   - The XState machine (owned by `useDisplayState`).
//   - The DOM <img> / <object> rendering (owned by the future
//     `<Sprite>` SFC in PR 2 of #1).
//   - The Tauri event listeners that call `onThemeUpdated` (owned
//     by the future `useRobotEvents` helper).
//
// Interface discipline: the composable takes `settings` (ref) and a
// `onThemeLoaded` callback as deps. It does not import the XState
// machine or any DOM API. The caller (RobotRoot.vue) wires the
// `onThemeLoaded` callback to the display-state composable's `send`.

import { ref, watch, type Ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ThemeManager } from "../theme-manager.js";
import type { ThemeManifest } from "../display-state-types";
import type { Settings } from "@/types/settings";

export interface UseThemeAssetsDeps {
  settings: Ref<Settings>;
  /** Forward the freshly-loaded manifest into the display-state
   * machine (e.g. `send({ type: "THEME_CHANGED", theme: m })`). */
  onThemeLoaded: (manifest: ThemeManifest) => void;
}

export interface UseThemeAssetsReturn {
  themeManager: ThemeManager;
  /** Whether the initial theme has been loaded at least once. */
  isReady: Ref<boolean>;
  /** Read the active theme id from settings and load it. Called on
   * mount and from the settings.theme watcher. */
  loadInitial: () => Promise<void>;
  /** User-driven theme switch (tray menu / settings UI). */
  onThemeIdChanged: (themeId: string) => Promise<void>;
  /** Dev-only path: theme.json was rewritten by the dev panel Save. */
  onThemeUpdated: (themeId: string) => Promise<void>;
}

export function useThemeAssets(deps: UseThemeAssetsDeps): UseThemeAssetsReturn {
  const { settings, onThemeLoaded } = deps;

  const themeManager = new ThemeManager();
  registerShippedThemes(themeManager);

  const isReady = ref(false);

  async function fetchFromPublicDir(themeId: string): Promise<ThemeManifest | null> {
    try {
      const res = await fetch(`/themes/${themeId}/theme.json`);
      if (!res.ok) {
        console.warn(
          `[useThemeAssets] theme.json fetch failed: ${res.status} ${res.statusText}`,
        );
        return null;
      }
      return (await res.json()) as ThemeManifest;
    } catch (err) {
      console.warn(`[useThemeAssets] theme fetch error: ${err}`);
      return null;
    }
  }

  async function onThemeIdChanged(themeId: string): Promise<void> {
    const manifest = await fetchFromPublicDir(themeId);
    if (!manifest) return;
    // reloadTheme re-registers the manifest so subsequent setTheme
    // picks up the fresh data (including timings — the inlined boot
    // literal lacks them). reloadTheme's notify only fires when
    // currentThemeId already matches the incoming id; for a real
    // switch (Uma → Calico) it skips the onChange → refreshSprite
    // path. So we explicitly call setTheme here to drive the sprite
    // refresh + hit-zone update.
    themeManager.reloadTheme(themeId, manifest);
    themeManager.setTheme(themeId);
    onThemeLoaded(manifest);
  }

  async function onThemeUpdated(themeId: string): Promise<void> {
    // Dev-only path: re-reads the manifest from disk because the
    // dev panel just wrote a new theme.json via theme_save.
    // theme_load itself is `#[cfg(debug_assertions)]` so this only
    // runs successfully in dev builds — that's the intended scope
    // (the dev panel is import.meta.env.DEV-gated in App.vue).
    try {
      const manifest = await invoke<ThemeManifest>("theme_load", { themeId });
      themeManager.reloadTheme(themeId, manifest);
      onThemeLoaded(manifest);
    } catch (err) {
      console.warn("[useThemeAssets] theme reload failed:", err);
    }
  }

  async function loadInitial(): Promise<void> {
    try {
      const stored = await invoke<{ theme_id?: string }>("get_settings");
      const themeId = stored?.theme_id ?? "uma";
      const manifest = await invoke<ThemeManifest>("theme_load", { themeId });
      themeManager.setTheme(themeId);
      onThemeLoaded(manifest);
    } catch (err) {
      console.warn("[useThemeAssets] initial theme load failed:", err);
      // Fall back to bundled default; the ThemeManager still has the
      // uma literal registered, so setTheme succeeds.
      themeManager.setTheme("uma");
    } finally {
      isReady.value = true;
    }
  }

  // React to settings.theme changes (e.g. user picks Calico in the
  // settings UI). The composable's own `onThemeIdChanged` handles the
  // fetch + apply. This replaces the manual watch that used to live
  // in RobotRoot.vue's onMounted.
  watch(
    () => settings.value.theme,
    (themeId) => {
      if (themeId) void onThemeIdChanged(themeId);
    },
  );

  return {
    themeManager,
    isReady,
    loadInitial,
    onThemeIdChanged,
    onThemeUpdated,
  };
}

// ── Theme registration ───────────────────────────────────────────────
//
// The two shipped themes (uma + calico). viewBox / hitBox / fileHitBox
// / wide + sleeping file lists / objectScale are byte-equivalent to
// the upstream theme spec (see ADR-0004). Asset files are also
// byte-equivalent (md5 verified).
//
// This block is data, not logic — but it's kept in the same file as
// the manager that owns it so theme registration is one place. To add
// a third theme, append a third `themeManager.registerTheme(...)` call
// here + add the assets under public/themes/<id>/. Don't inline this
// in a SFC.

function registerShippedThemes(themeManager: ThemeManager): void {
  themeManager.registerTheme("uma", {
    name: "Uma",
    viewBox: { x: -15, y: -25, width: 45, height: 45 },
    fileViewBoxes: {},
    hitBoxes: {
      default: { x: -1, y: 5, width: 17, height: 12 },
      sleeping: { x: -2, y: 9, width: 19, height: 7 },
      wide: { x: -3, y: 3, width: 21, height: 14 },
    },
    fileHitBoxes: {
      "uma-working-typing.svg": { x: -2, y: -7, width: 20, height: 24 },
    },
    wideHitboxFiles: ["uma-error.svg", "uma-notification.svg"],
    sleepingHitboxFiles: ["uma-sleeping.svg", "uma-collapse-sleep.svg"],
    objectScale: {
      widthRatio: 1.9,
      heightRatio: 1.3,
      offsetX: -0.45,
      offsetY: -0.25,
    },
    states: {
      idle: { file: "uma-idle-follow.svg", type: "svg" },
      thinking: { file: "uma-working-thinking.svg", type: "svg" },
      working: { file: "uma-working-typing.svg", type: "svg" },
      building: { file: "uma-working-building.svg", type: "svg" },
      attention: { file: "uma-happy.svg", type: "svg" },
      error: { file: "uma-error.svg", type: "svg" },
      notification: { file: "uma-notification.svg", type: "svg" },
      sleeping: { file: "uma-sleeping.svg", type: "svg" },
      waking: { file: "uma-wake.svg", type: "svg" },
      sweeping: { file: "uma-working-sweeping.svg", type: "svg" },
      carrying: { file: "uma-working-carrying.svg", type: "svg" },
      "subagent-groove": { file: "uma-headphones-groove.svg", type: "svg" },
      juggling: { file: "uma-working-juggling.svg", type: "svg" },
    },
  });

  themeManager.registerTheme("calico", {
    name: "Calico",
    viewBox: { x: 0, y: 0, width: 266, height: 200 },
    fileViewBoxes: {},
    hitBoxes: {
      default: { x: 80, y: 30, width: 106, height: 140 },
      sleeping: { x: 60, y: 60, width: 146, height: 100 },
      wide: { x: 50, y: 20, width: 166, height: 160 },
    },
    fileHitBoxes: {},
    wideHitboxFiles: [
      "calico-error.apng",
      "calico-notification.apng",
      "calico-working-conducting.apng",
    ],
    sleepingHitboxFiles: ["calico-sleeping.apng", "calico-collapsing.apng"],
    objectScale: {
      widthRatio: 0.58,
      heightRatio: 0.44,
      imgWidthRatio: 0.6,
      objBottom: 0.05,
      imgBottom: 0.05,
      offsetX: 0.21,
      offsetY: 0.28,
      fileScales: {
        "calico-idle-follow.svg": 1.015,
        "calico-idle.apng": 1.05,
        "calico-thinking.apng": 1.2,
        "calico-working-typing.apng": 1.2,
        "calico-working-juggling.apng": 1.2,
        "calico-working-building.apng": 1.25,
        "calico-working-conducting.apng": 1.2,
        "calico-working-sweeping.apng": 1.25,
        "calico-working-carrying.apng": 1.4,
        "calico-notification.apng": 1.02,
        "calico-error.apng": 1.25,
        "calico-happy.apng": 1.2,
        "calico-yawning.apng": 1.15,
        "calico-dozing.apng": 0.86,
        "calico-collapsing.apng": 1.05,
        "calico-sleeping.apng": 1.05,
        "calico-waking.apng": 1.05,
        "calico-react-poke.apng": 1.05,
        "calico-react-drag.apng": 1.1,
        "calico-mini-idle.apng": 1.15,
        "calico-mini-alert.apng": 1.15,
        "calico-mini-happy.apng": 1.15,
        "calico-mini-enter.apng": 1.15,
        "calico-mini-peek.apng": 1.15,
        "calico-mini-crabwalk.apng": 1.05,
        "calico-mini-sleep.apng": 1.15,
      },
      fileOffsets: {
        "calico-idle-follow.svg": { x: -5, y: -5 },
        "calico-idle.apng": { x: 10, y: -3 },
        "calico-thinking.apng": { x: 0, y: 13 },
        "calico-working-typing.apng": { x: -3, y: -5 },
        "calico-working-juggling.apng": { x: 0, y: -5 },
        "calico-working-building.apng": { x: 0, y: -5 },
        "calico-working-conducting.apng": { x: 0, y: -5 },
        "calico-working-sweeping.apng": { x: -16, y: 6 },
        "calico-working-carrying.apng": { x: -24, y: 10 },
        "calico-notification.apng": { x: 9, y: 0 },
        "calico-error.apng": { x: 0, y: 7 },
        "calico-happy.apng": { x: 8, y: 6 },
        "calico-yawning.apng": { x: 8, y: 8 },
        "calico-dozing.apng": { x: 7, y: 4 },
        "calico-collapsing.apng": { x: 8, y: -5 },
        "calico-sleeping.apng": { x: 8, y: -5 },
        "calico-waking.apng": { x: 8, y: -5 },
        "calico-react-poke.apng": { x: 10, y: 0 },
        "calico-react-drag.apng": { x: 0, y: 6 },
        "calico-mini-idle.apng": { x: 0, y: 65 },
        "calico-mini-alert.apng": { x: 0, y: 65 },
        "calico-mini-happy.apng": { x: 0, y: 65 },
        "calico-mini-enter.apng": { x: 0, y: 65 },
        "calico-mini-peek.apng": { x: 0, y: 65 },
        "calico-mini-crabwalk.apng": { x: 0, y: 65 },
        "calico-mini-sleep.apng": { x: 0, y: 65 },
      },
    },
    states: {
      idle: { file: "calico-idle.apng", type: "apng" },
      thinking: { file: "calico-thinking.apng", type: "apng" },
      working: { file: "calico-working-typing.apng", type: "apng" },
      building: { file: "calico-working-building.apng", type: "apng" },
      attention: { file: "calico-happy.apng", type: "apng" },
      error: { file: "calico-error.apng", type: "apng" },
      notification: { file: "calico-notification.apng", type: "apng" },
      sleeping: { file: "calico-sleeping.apng", type: "apng" },
      waking: { file: "calico-waking.apng", type: "apng" },
      sweeping: { file: "calico-working-sweeping.apng", type: "apng" },
      carrying: { file: "calico-working-carrying.apng", type: "apng" },
      "subagent-groove": { file: "calico-conducting.apng", type: "apng" },
      juggling: { file: "calico-working-juggling.apng", type: "apng" },
    },
  });
}