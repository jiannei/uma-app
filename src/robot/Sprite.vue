<script setup lang="ts">
// src/robot/Sprite.vue — Sprite renderer (ADR-0004 §Rendering paths).
//
// Originally a dual-element renderer: <img> for APNG, <object> for SVG.
// The <object> path was kept around so the SVG would be parsed as a
// document (allowing outer CSS to target internals if needed) and so
// getBoundingClientRect could be read from the live element. In
// practice on Tauri 2 macOS, <object> loaded with an SVG reports a
// 0×0 bounding rect AND renders as 0×0 visually — the SVG never
// appears, even though the data attribute is set and no error fires.
// (See [[tauri-webview-object-rect-zero]] for the longer writeup.)
//
// Chromium renders SVG natively inside <img>, so we use <img> for both
// SVG and APNG themes. **But** <img> has a separate Chromium quirk:
// when its CSS `width` is a percentage > 100% of its containing block
// AND the source has intrinsic dimensions (e.g. SVG with width="500"),
// the rendered offsetWidth is silently clamped to the containing
// block's width. Same element with `width: 190%` in a 144px box
// renders at 144px instead of 273.6px; height respects the
// percentage, so the result is a squashed / off-center sprite.
// `height: auto` + width-only test reproduces it.
//
// Workaround: don't put the percentages directly on <img>. Wrap <img>
// in a <div> that owns the sizing + positioning (offsetX, bottom,
// width/height as percentages), and let <img> fill its parent with
// `width: 100%; height: 100%; object-fit: fill`. Plain <div> doesn't
// have the replaced-element quirk.
//
// This SFC owns:
//   - The wrapper div DOM ref (the geometry carrier)
//   - The inner img DOM ref (the asset carrier)
//   - The `spriteStyle` ref (the inline geometry applied to wrapper)
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
//   - `getActiveElement()` — returns the visible img DOM node.
//     RobotRoot.vue's `updateHitZone()` uses this to read the
//     bounding rect.

import { ref, watch, onMounted, onBeforeUnmount, type CSSProperties } from "vue";
import type { DisplayState } from "./display-state-types";
import { ThemeManager } from "./theme-manager.js";

const props = defineProps<{
  state: DisplayState;
  themeManager: ThemeManager;
}>();

const activeSprite = ref<"img" | null>(null);
const spriteStyle = ref<CSSProperties>({});
const viewportOffsetY = ref(0);

// Wrapper <div> owns sizing + positioning (percentages), the inner
// <img> fills the wrapper at 100% (avoids Chromium's replaced-
// element percent-width quirk, see file header).
const sprite = ref<HTMLImageElement | null>(null);

function setActiveElement(_type: string): void {
  // Until a theme loads, stay hidden — avoids flashing an empty
  // <img src=""> at (0,0) which would show as a 0×0 box.
  if (!props.themeManager.getCurrentTheme()) {
    activeSprite.value = null;
    return;
  }
  // Always use <img>; both SVG and APNG render correctly inside it
  // in Chromium-based Tauri webviews (see file header).
  activeSprite.value = "img";
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
  if (url && sprite.value) {
    // SVG and APNG both render correctly inside <img> in Chromium.
    sprite.value.src = url;
  }
  applyStyle();
}

function getActiveElement(): HTMLImageElement | null {
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
  <div
    id="robot-sprite-wrapper"
    :class="['sprite-base', activeSprite === 'img' ? 'block' : 'hidden']"
    :style="spriteStyle"
  >
    <img
      ref="sprite"
      id="robot-sprite"
      style="width:100%;height:100%;display:block;image-rendering:pixelated;object-fit:fill"
      src=""
      alt="robot"
      @load="refreshSprite"
    />
  </div>
</template>
