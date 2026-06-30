<script setup lang="ts">
// src/robot/RobotRoot.vue — Robot window Vue app (chassis).
//
// After the RobotRoot split, this file is the orchestrator that
// wires 4 leaf composables + 2 helpers (Sprite SFC + useRobotEvents)
// into the runtime. Cross-composable rules (e.g. "attention state
// plays the complete sound") live here as explicit watchers; each
// composable owns only its own concern.
//
// Per ADR-0004, this window is 200×200 transparent + always-on-top;
// the sprite container is pointer-events: none except the per-asset
// hit-zone which captures pointerdown for window dragging.

import { ref, watch, onMounted, type CSSProperties } from "vue";
import { useEventListener } from "@vueuse/core";
import { useSettings } from "@/composables/useSettings";
import { useThemeAssets } from "./composables/useThemeAssets";
import { useDisplayState } from "./composables/useDisplayState";
import { useRobotWindow } from "./composables/useRobotWindow";
import { useRobotAudio } from "./composables/useRobotAudio";
import { useRobotEvents } from "./composables/useRobotEvents";
import Sprite from "./Sprite.vue";

const { settings } = useSettings();

// ── Composables ───────────────────────────────────────────────────
// Display state + theme assets are wired together: when useThemeAssets
// loads a fresh manifest, it calls `applyTheme` on the display-state
// machine. The state ref is what the cross-cutting watcher below
// reads to drive the sprite + audio.

const displayState = useDisplayState();
const themeAssets = useThemeAssets({
  settings,
  onThemeLoaded: (m) => displayState.applyTheme(m),
});
const robotWindow = useRobotWindow();
const audio = useRobotAudio({ settings });

// Sprite SFC ref — the orchestrator reads its exposed `getActiveElement`
// to compute the hit-zone geometry, and calls its `refresh()` after
// every state transition.
const spriteRef = ref<InstanceType<typeof Sprite> | null>(null);

// Hit-zone DOM ref (kept in the chassis because the hit-zone is
// coupled with the drag handle inside useRobotWindow).
const hitZone = ref<HTMLDivElement | null>(null);
const hitZoneStyle = ref<CSSProperties | null>(null);

// ── Hit-zone geometry (depends on the sprite's bounding rect) ────
function updateHitZone(): void {
  const active = spriteRef.value?.getActiveElement();
  if (!active) {
    hitZoneStyle.value = null;
    return;
  }
  const renderedRect = active.getBoundingClientRect();
  const hitRect = themeAssets.themeManager.computeScreenHitRect(
    displayState.state.value,
    renderedRect,
  );
  if (!hitRect) {
    hitZoneStyle.value = null;
    return;
  }
  hitZoneStyle.value = {
    left: `${hitRect.x}px`,
    top: `${hitRect.y}px`,
    width: `${hitRect.width}px`,
    height: `${hitRect.height}px`,
  };
}

// ── Cross-cutting rule: state transition → sprite + hit-zone + sound
watch(displayState.state, (next, prev) => {
  if (next === prev) return;
  // Sprite's own `watch(state, refresh)` already fires refreshSprite,
  // but the hit-zone depends on the rendered rect (which Sprite just
  // re-painted), so we recompute it here. The "attention → complete
  // sound" rule is also cross-cutting.
  updateHitZone();
  if (next === "attention" && prev !== "attention") {
    audio.playSound("complete");
  }
});

// ── DOM event listeners (drag handle + peek-on-hover) ───────────
useEventListener(hitZone, "pointerdown", (e) => {
  robotWindow.onHitZonePointerDown(e);
  if (hitZone.value) hitZone.value.setPointerCapture(e.pointerId);
});
useEventListener(document, "mousemove", robotWindow.onMouseMove);

// ── Tauri event wiring ───────────────────────────────────────────
useRobotEvents({
  onAgentHook: (event) => displayState.send({ type: "AGENT_HOOK", event }),
  onThemeUpdated: (themeId) => void themeAssets.onThemeUpdated(themeId),
  onWindowMove: () => {
    if (!robotWindow.isMiniMode.value) void robotWindow.checkEdgeSnap();
    updateHitZone();
  },
  onSyntheticEvent: (event) =>
    displayState.send({ type: "AGENT_HOOK", event }),
  onReset: () => displayState.send({ type: "RESET" }),
  onDebugStyle: (patch) => {
    const root = document.documentElement.style;
    root.setProperty("--debug-window-bg", patch.windowBg || "transparent");
    root.setProperty("--debug-sprite-bg", patch.spriteBg || "transparent");
    root.setProperty("--debug-hitzone-bg", patch.hitzoneBg || "transparent");
  },
});

// ── Initial mount ────────────────────────────────────────────────
onMounted(async () => {
  await themeAssets.loadInitial();
  // Defensive re-paint (setTheme() short-circuits without notify
  // when currentThemeId === themeId; the Sprite's own onMounted
  // refresh handles the first paint, but if a stale initial state
  // exists this ensures a clean re-paint).
  spriteRef.value?.refresh();
  updateHitZone();
});
</script>

<template>
  <div
    ref="hitZone"
    id="hit-zone"
    :class="['fixed pointer-events-auto cursor-grab touch-none z-10 active:cursor-grabbing bg-[var(--debug-hitzone-bg,transparent)]', hitZoneStyle ? 'block' : 'hidden']"
    :style="hitZoneStyle || undefined"
  ></div>
  <div
    id="robot-container"
    class="relative flex items-center justify-center w-full h-full pointer-events-none"
  >
    <Sprite
      ref="spriteRef"
      :state="displayState.state.value"
      :theme-manager="themeAssets.themeManager"
    />
  </div>
</template>
