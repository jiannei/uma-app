<script setup lang="ts">
// src/robot/RobotRoot.vue — Robot window Vue app (was inline <script> in robot.html).
//
// Hosts the entire robot runtime: theme manager, sprite rendering, sound,
// drag, mini mode, Tauri event listeners, and the XState-based
// DisplayStateResolver (via `useMachine`). Per ADR-0006 §Decision, the
// resolver consumes `theme.timings` for sleep-sequence + auto-return
// durations; theme changes are forwarded via the THEME_CHANGED event.
//
// Per ADR-0004, this window is 200×200 transparent + always-on-top;
// the sprite container is pointer-events: none except the per-asset
// hit-zone which captures pointerdown for window dragging.

import { ref, watch, onMounted, onUnmounted, computed, type CSSProperties } from "vue";
import { useMachine } from "@xstate/vue";
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { displayStateResolver } from "./display-state-resolver";
import { DEFAULT_THEME } from "./display-state-constants";
import { ThemeManager } from "./theme-manager.js";
import type { DisplayState, HookEvent, ThemeManifest } from "./display-state-types";

// ── Theme registration (copied verbatim from robot.html L114-254) ──
//
// viewBox / hitBox / fileHitBox / wide + sleeping file lists /
// objectScale are byte-equivalent to upstream uma-pet. Asset files
// are also byte-equivalent (md5 verified). Keys translated w→width,
// h→height. See ADR-0004.

const themeManager = new ThemeManager();

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

// Which of the two sprite elements is currently visible: "img" for
// APNG, "svg" for <object>, null before any theme loads. The shared
// `sprite-base` class (absolute + pointer-events-none + pixelated +
// debug bg) is defined via @apply in tailwind.css @layer components.
const activeSprite = ref<"img" | "svg" | null>(null);

// Inline geometry/size of the active sprite. `applyStyle()` recomputes
// this on every theme/state change; null until the first theme loads.
const spriteStyle = ref<CSSProperties>({});

// Inline geometry of the hit-zone. `null` means "hide" (drives the
// `block/hidden` toggle via :class). When set, contains left/top/width
// height in absolute pixels — written by `updateHitZone()` from
// `getBoundingClientRect()` projected through the theme's hit-box.
const hitZoneStyle = ref<CSSProperties | null>(null);

// ── DOM refs (must be after <template>) ─────────────────────────

const sprite = ref<HTMLImageElement | null>(null);
const robotObject = ref<HTMLObjectElement | null>(null);
const hitZone = ref<HTMLDivElement | null>(null);

// ── DisplayStateResolver (XState v5 via @xstate/vue) ────────────

// useMachine must be called with sync input. We start with DEFAULT_THEME
// and swap to the real theme after mount + on every theme-change.
const { snapshot: smSnapshot, send } = useMachine(displayStateResolver, {
  input: { theme: DEFAULT_THEME as unknown as ThemeManifest },
});

// Track current resolved display state (mirrors `context.displayState`).
// The XState machine writes displayState on every transition; we keep
// a separate ref for cheap comparison in setDisplayState().
const currentDisplayState = ref<DisplayState>("idle");
const smDisplayState = computed(() => smSnapshot.value.context.displayState);
watch(
  smDisplayState,
  (next) => {
    setDisplayState(next);
  },
  { immediate: true },
);

// When theme changes via theme-change / theme-updated, forward to
// the XState machine so timing-driven transitions (auto-return,
// sleep sequence) use new values.
function applyTheme(theme: ThemeManifest) {
  send({ type: "THEME_CHANGED", theme });
}

// ── Dual-element rendering (ADR-0004 §Rendering paths) ───────────

function setActiveElement(type: string) {
  // Until a theme loads, stay hidden — avoids flashing an empty
  // <img src=""> at (0,0) which would show as a 0×0 box.
  if (!themeManager.getCurrentTheme()) {
    activeSprite.value = null;
    return;
  }
  activeSprite.value = type === "svg" ? "svg" : "img";
}

function getActiveSpriteElement(): HTMLImageElement | HTMLObjectElement | null {
  if (activeSprite.value === "svg") return robotObject.value;
  if (activeSprite.value === "img") return sprite.value;
  return null;
}

function refreshSprite() {
  const currentTheme = themeManager.getCurrentTheme();
  const url = themeManager.getAssetUrl(currentDisplayState.value);
  const stateDef = currentTheme?.states?.[currentDisplayState.value];
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

// Re-render whenever theme changes (setTheme / reloadTheme). Registered
// after theme-manager instantiation so the first setTheme() during mount
// triggers a re-paint of the (now non-null) sprite URL.
themeManager.onChange(() => {
  refreshSprite();
  updateHitZone();
});

// Apply theme.objectScale to the active sprite element. Result is
// written to `spriteStyle` (a Vue ref bound to :style on both <img>
// and <object>), so the active element picks it up automatically.
//
// Positioning is **bottom-anchored** (matching uma-pet's renderer.js):
//   bottom = objBottom (or derived from offsetY + heightRatio) + fileOffset.y + viewportOffsetY
// This keeps the sprite standing on the container bottom regardless of
// how tall the sprite's CSS box is. The uma theme's default:
//   objBottom = 1 - (-0.25) - 1.3 = -0.05 → sprite extends 5% below the
//   container bottom (compensated by viewportOffsetY for titlebar).
function applyStyle() {
  const os = themeManager.getObjectScale();
  if (!os) {
    spriteStyle.value = {};
    return;
  }
  const stateDef = themeManager.getCurrentTheme()?.states?.[
    currentDisplayState.value
  ];
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

  // Bottom-anchored positioning. Theme can override objBottom/imgBottom
  // directly; otherwise derive from offsetY + heightRatio (same formula
  // as uma-pet's renderer.js L58).
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

/**
 * Titlebar / window-offset compensation (px). Added to the bottom anchor
 * so the sprite doesn't hide under the window's titlebar area. Default 0
 * (uma-app hides decorations); wire up to Tauri's window titlebar height
 * when needed.
 */
const viewportOffsetY = ref(0);

// Map current state's viewBox hit-box through the sprite's actual
// rendered rect and write the result to `hitZoneStyle` (a Vue ref
// bound to :style on #hit-zone). `null` means "hide" — the template
// :class switches to `hidden` in that case. See ADR-0004.
function updateHitZone() {
  const active = getActiveSpriteElement();
  if (!active) {
    hitZoneStyle.value = null;
    return;
  }
  const renderedRect = active.getBoundingClientRect();
  const hitRect = themeManager.computeScreenHitRect(
    currentDisplayState.value,
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

function setDisplayState(state: DisplayState) {
  if (state === currentDisplayState.value) return;
  const prevState = currentDisplayState.value;
  currentDisplayState.value = state;
  refreshSprite();
  updateHitZone();
  if (state === "attention" && prevState !== "attention") {
    playSound("complete");
  }
}

// ── Sound playback (10s cooldown) ───────────────────────────────

const settings = { sound_enabled: true };
let lastSoundTime = 0;
const SOUND_COOLDOWN_MS = 10000;
const audioCache = new Map<string, HTMLAudioElement>();

function playSound(name: string) {
  if (!settings.sound_enabled) return;
  const now = Date.now();
  if (now - lastSoundTime < SOUND_COOLDOWN_MS) return;
  lastSoundTime = now;

  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(`/sounds/${name}.mp3`);
    audio.volume = 0.5;
    audioCache.set(name, audio);
  }
  audio.currentTime = 0;
  audio.play().catch((err) => {
    console.warn(`[robot] sound play failed: ${err}`);
  });
}

// ── Drag + mini mode (was inline in robot.html L500-649) ──────────

const FULL_SIZE = { width: 144, height: 144 };
const MINI_SIZE = { width: 96, height: 96 };
const EDGE_THRESHOLD = 30;
let isMiniMode = false;
let isPeeking = false;
let preMiniPosition: { x: number; y: number } | null = null;
const currentWindow = getCurrentWindow();

async function getScaleFactor(): Promise<number> {
  try {
    const monitor = await currentMonitor();
    if (monitor && monitor.scaleFactor) return monitor.scaleFactor;
  } catch (err) {
    console.warn("[robot] getScaleFactor failed:", err);
  }
  return window.devicePixelRatio || 1;
}

async function getScreenSize(): Promise<{ width: number; height: number }> {
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      const scale = monitor.scaleFactor || 1;
      return {
        width: Math.round(monitor.size.width / scale),
        height: Math.round(monitor.size.height / scale),
      };
    }
  } catch (err) {
    console.warn("[robot] currentMonitor failed:", err);
  }
  return { width: window.screen.width, height: window.screen.height };
}

async function getLogicalWindowPos(): Promise<{ x: number; y: number }> {
  const pos = await currentWindow.outerPosition();
  const scale = await getScaleFactor();
  return { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale) };
}

async function enterMiniMode() {
  if (isMiniMode) return;
  isMiniMode = true;
  console.log("[robot] entering mini mode");

  try {
    const pos = await getLogicalWindowPos();
    if (preMiniPosition === null) {
      preMiniPosition = { x: pos.x, y: pos.y };
      console.log("[robot] pre-mini pos (logical):", preMiniPosition);
    }
  } catch (err) {
    console.warn("[robot] failed to get position:", err);
  }

  try {
    const screenSize = await getScreenSize();
    if (!screenSize) return;

    const newX = screenSize.width - MINI_SIZE.width;
    const newY = preMiniPosition?.y ?? 100;
    await currentWindow.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));
    await currentWindow.setPosition(new LogicalPosition(newX, newY));
  } catch (err) {
    console.warn("[robot] resize failed:", err);
    isMiniMode = false;
  }
}

async function checkEdgeSnap() {
  try {
    const pos = await getLogicalWindowPos();
    const screenSize = await getScreenSize();
    if (!screenSize) return;
    const distToRight = screenSize.width - (pos.x + FULL_SIZE.width);
    if (distToRight < EDGE_THRESHOLD && !isMiniMode) {
      await enterMiniMode();
    }
  } catch (err) {
    console.warn("[robot] edge check failed:", err);
  }
}

function onHitZonePointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  e.preventDefault();
  if (hitZone.value) hitZone.value.setPointerCapture(e.pointerId);
  currentWindow.startDragging().catch((err) => {
    console.error("[robot] startDragging failed:", err);
  });
}

function onMouseMove(e: MouseEvent) {
  if (!isMiniMode) return;
  const screenW = window.screen.width;
  const distToRight = screenW - e.screenX;
  const shouldPeek = distToRight < 20;
  if (shouldPeek !== isPeeking) {
    isPeeking = shouldPeek;
    void (async () => {
      const size = shouldPeek ? FULL_SIZE : MINI_SIZE;
      const screenSize = await getScreenSize();
      const newX = screenSize.width - size.width;
      const newY = preMiniPosition?.y ?? 100;
      try {
        await currentWindow.setSize(new LogicalSize(size.width, size.height));
        await currentWindow.setPosition(new LogicalPosition(newX, newY));
      } catch (err) {
        console.warn("[robot] peek resize failed:", err);
      }
    })();
  }
}

// ── Tauri event wiring ──────────────────────────────────────────

const unsubscribers: UnlistenFn[] = [];

onMounted(async () => {
  // Initial paint (was the trailing refreshSprite() in robot.html L651).
  refreshSprite();
  updateHitZone();

  // Fetch the active theme manifest so the XState machine's timings
  // match the user's saved theme.
  try {
    const settings = await invoke<{ theme_id?: string }>("get_settings");
    const themeId = settings?.theme_id ?? "uma";
    const theme = await invoke<ThemeManifest>("theme_load", { themeId });
    themeManager.setTheme(themeId);
    applyTheme(theme);
    // Defensive: setTheme() short-circuits without notify when
    // currentThemeId === themeId. Re-paint unconditionally so a stale
    // initial state (e.g. theme was set during an earlier failed mount)
    // doesn't leave the sprite blank.
    refreshSprite();
    updateHitZone();
  } catch (err) {
    console.warn("[robot] initial theme load failed:", err);
    themeManager.setTheme("uma");
    refreshSprite();
    updateHitZone();
  }

  // Theme change broadcasts → swap theme in ThemeManager AND XState.
  unsubscribers.push(
    await listen("theme-change", async (e) => {
      const themeId = (e.payload as { theme?: string })?.theme;
      if (themeId) themeManager.setTheme(themeId);
    }),
  );
  unsubscribers.push(
    await listen("theme-updated", async (e) => {
      const themeId = (e.payload as { theme?: string })?.theme;
      if (!themeId) return;
      try {
        const manifest = await invoke<ThemeManifest>("theme_load", {
          themeId,
        });
        themeManager.reloadTheme(themeId, manifest);
        applyTheme(manifest);
      } catch (err) {
        console.warn("[robot] theme reload failed:", err);
      }
    }),
  );

  // DND change → pause any in-flight sounds. ADR-0006 §Context point 5:
  // DND does NOT suppress state transitions (that work is future).
  unsubscribers.push(
    await listen("dnd-change", (e) => {
      const dnd = (e.payload as { dnd?: boolean })?.dnd;
      if (dnd) {
        audioCache.forEach((a) => a.pause());
      }
    }),
  );

  // Real agent hook events from HTTP server.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const payload = e.payload as HookEvent;
      send({ type: "AGENT_HOOK", event: payload });
      // ADR-0003 cleanup: when a session ends, drop its always-allow set.
      if (payload.event_type === "SessionEnd" && payload.session_id) {
        invoke("clear_always_allow_session", {
          agentId: payload.agent || "unknown",
          sessionId: payload.session_id,
        }).catch((err) =>
          console.warn("[robot] clear_always_allow_session failed:", err),
        );
      }
    }),
  );

  // Dev-tools synthetic events (mirrors real path's SessionEnd chain).
  unsubscribers.push(
    await listen("devtools-synthetic-event", (e) => {
      const ev = (e.payload as { event?: HookEvent })?.event;
      if (!ev) return;
      send({ type: "AGENT_HOOK", event: ev });
      if (ev.event_type === "SessionEnd" && ev.session_id) {
        invoke("clear_always_allow_session", {
          agentId: ev.agent || "unknown",
          sessionId: ev.session_id,
        }).catch((err) =>
          console.warn(
            "[robot] clear_always_allow_session (synthetic) failed:",
            err,
          ),
        );
      }
    }),
  );

  // Dev-tools Reset (ADR-0005 D7).
  unsubscribers.push(
    await listen("devtools-reset", () => {
      send({ type: "RESET" });
    }),
  );

  // Visual debug (ADR-0005 D9).
  unsubscribers.push(
    await listen("devtools-robot-debug-style", (e) => {
      const p = (e.payload as {
        windowBg?: string;
        spriteBg?: string;
        hitzoneBg?: string;
      }) || {};
      const root = document.documentElement.style;
      root.setProperty("--debug-window-bg", p.windowBg || "transparent");
      root.setProperty("--debug-sprite-bg", p.spriteBg || "transparent");
      root.setProperty("--debug-hitzone-bg", p.hitzoneBg || "transparent");
    }),
  );

  // Window-move listener for edge-snap + hit-zone recompute.
  unsubscribers.push(
    await listen("tauri://move", () => {
      if (!isMiniMode) void checkEdgeSnap();
      updateHitZone();
    }),
  );

  // Hit-zone drag start (DOM event).
  if (hitZone.value) {
    hitZone.value.addEventListener("pointerdown", onHitZonePointerDown);
  }

  // Mouse-move for peek-on-hover.
  document.addEventListener("mousemove", onMouseMove);
});

onUnmounted(() => {
  for (const u of unsubscribers) u();
  unsubscribers.length = 0;
  if (hitZone.value) {
    hitZone.value.removeEventListener("pointerdown", onHitZonePointerDown);
  }
  document.removeEventListener("mousemove", onMouseMove);
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
    <img
      ref="sprite"
      id="robot-sprite"
      :class="['sprite-base', activeSprite === 'img' ? 'block' : 'hidden']"
      :style="spriteStyle"
      src=""
      alt="robot"
      @load="updateHitZone"
    />
    <object
      ref="robotObject"
      id="robot-object"
      type="image/svg+xml"
      data=""
      :class="['sprite-base', activeSprite === 'svg' ? 'block' : 'hidden']"
      :style="spriteStyle"
      @load="updateHitZone"
    ></object>
  </div>
</template>
