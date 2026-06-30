<script setup lang="ts">
// src/robot/Sprite.vue — Dual-element sprite renderer (ADR-0004 §Rendering paths).
//
// Encapsulates the img/object dual-element rendering pattern. The
// robot window needs both: <img> for APNG (browser-native playback)
// and <object> for SVG (so the browser parses the SVG and the page
// can read its bounding rect — Tauri webviews return 0×0 for
// <object>, hence the dual-element dance).
//
// This SFC owns:
//   - The img + object DOM refs
//   - The `activeSprite` ref (which of the two is currently visible)
//   - The `spriteStyle` ref (the inline geometry applied to both)
//   - The `viewportOffsetY` ref (titlebar compensation)
//   - The refreshSprite() / applyStyle() logic
//
// Props:
//   - `state: DisplayState` — the current display state. When this
//     changes, the sprite re-renders with the new state's asset.
//   - `themeManager: ThemeManager` — provides getCurrentTheme /
//     getAssetUrl / getObjectScale. The component subscribes to
//     themeManager.onChange() on mount to re-render when the theme
//     is switched or reloaded.
//
// Exposed via defineExpose:
//   - `getActiveElement()` — returns the currently-visible img or
//     object DOM node. RobotRoot.vue's `updateHitZone()` uses this
//     to read the bounding rect.

import { ref, watch, onMounted, onBeforeUnmount, type CSSProperties } from "vue";
import type { DisplayState } from "./display-state-types";
import { ThemeManager } from "./theme-manager.js";

const props = defineProps<{
  state: DisplayState;
  themeManager: ThemeManager;
}>();

const activeSprite = ref<"img" | "svg" | null>(null);
const spriteStyle = ref<CSSProperties>({});
const viewportOffsetY = ref(0);

const sprite = ref<HTMLImageElement | null>(null);
const robotObject = ref<HTMLObjectElement | null>(null);

function setActiveElement(type: string): void {
  // Until a theme loads, stay hidden — avoids flashing an empty
  // <img src=""> at (0,0) which would show as a 0×0 box.
  if (!props.themeManager.getCurrentTheme()) {
    activeSprite.value = null;
    return;
  }
  activeSprite.value = type === "svg" ? "svg" : "img";
}

function applyStyle(): void {
  const os = props.themeManager.getObjectScale();
  if (!os) {
    spriteStyle.value = {};
    return;
  }
  const stateDef = props.themeManager.getCurrentTheme()?.states?.[props.state];
  const file = stateDef?.file;
  const fileScales = os.fileScales || {};
  const fileOffsets = os.fileOffsets || {};
  const scale = (file && fileScales[file]) || 1.0;
  const fo = (file && fileOffsets[file]) || { x: 0, y: 0 };
  const isSvg = stateDef?.type === "svg";

  const widthRatio = isSvg
    ? (os.widthRatio || 1)
    : (os.imgWidthRatio != null
        ? os.imgWidthRatio
        : (os.widthRatio || 1)) * scale;
  const heightRatio = isSvg ? (os.heightRatio || 1) : null;

  const leftPct = (os.offsetX || 0) * 100;

  // Bottom-anchored positioning (see ADR-0004 for the derivation).
  const objBottom =
    os.objBottom != null
      ? os.objBottom
      : 1 - (os.offsetY || 0) - (os.heightRatio || 1);
  const imgBottom = os.imgBottom != null ? os.imgBottom : 0.05;
  const bottomRatio = isSvg ? objBottom : imgBottom;

  spriteStyle.value = {
    width: `${widthRatio * 100}%`,
    height: heightRatio != null ? `${heightRatio * 100}%` : "auto",
    left: `calc(${leftPct}% + ${fo.x}px)`,
    top: "auto",
    bottom: `calc(${bottomRatio * 100}% + ${fo.y}px + ${viewportOffsetY.value}px)`,
  };
}

function refreshSprite(): void {
  const currentTheme = props.themeManager.getCurrentTheme();
  const url = props.themeManager.getAssetUrl(props.state);
  const stateDef = currentTheme?.states?.[props.state];
  const type = stateDef?.type || "apng";
  setActiveElement(type);
  if (url) {
    if (type === "svg" && robotObject.value) {
      robotObject.value.data = url;
    } else if (sprite.value) {
      sprite.value.src = url;
    }
  }
  applyStyle();
}

function getActiveElement(): HTMLImageElement | HTMLObjectElement | null {
  if (activeSprite.value === "svg") return robotObject.value;
  if (activeSprite.value === "img") return sprite.value;
  return null;
}

defineExpose({ getActiveElement, refresh: refreshSprite });

// Re-render on display-state change.
watch(
  () => props.state,
  () => refreshSprite(),
);

// Re-render on theme change. ThemeManager.onChange returns an
// unsubscribe function we keep for cleanup.
let unsubscribeTheme: (() => void) | null = null;
onMounted(() => {
  unsubscribeTheme = props.themeManager.onChange(() => refreshSprite());
  refreshSprite();
});
onBeforeUnmount(() => {
  if (unsubscribeTheme) unsubscribeTheme();
});
</script>

<template>
  <img
    ref="sprite"
    id="robot-sprite"
    :class="['sprite-base', activeSprite === 'img' ? 'block' : 'hidden']"
    :style="spriteStyle"
    src=""
    alt="robot"
    @load="refreshSprite"
  />
  <object
    ref="robotObject"
    id="robot-object"
    type="image/svg+xml"
    data=""
    :class="['sprite-base', activeSprite === 'svg' ? 'block' : 'hidden']"
    :style="spriteStyle"
    @load="refreshSprite"
  ></object>
</template>
