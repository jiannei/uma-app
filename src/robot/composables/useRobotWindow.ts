// src/robot/composables/useRobotWindow.ts — Owns the window state
// (mini mode, peek), the drag handle, the edge-snap logic, and the
// peek-on-hover behavior.
//
// What lives here:
//   - `isMiniMode` / `isPeeking` (Refs, replacing the bare `let` that
//     used to live in RobotRoot.vue — they were never reactive
//     before, which made peek toggles invisible to Vue)
//   - `preMiniPosition` (the saved x/y before entering mini mode, so
//     "exit mini" can return to where the user dragged from)
//   - `enterMiniMode()` / `exitMiniMode()` / `checkEdgeSnap()`
//   - `onHitZonePointerDown` (drag handle)
//   - `onMouseMove` (peek trigger — fires only while in mini mode)
//
// What does NOT live here:
//   - The sprite rendering (owned by the future `<Sprite>` SFC in
//     PR 2 of #1).
//   - The hit-zone DOM element ref (caller's responsibility; the
//     pointerdown handler takes the ref as a dep).
//   - The `tauri://move` event listener that calls `checkEdgeSnap()`
//     (owned by the future `useRobotEvents` helper).

import { ref, type Ref } from "vue";
import {
  getCurrentWindow,
  currentMonitor,
} from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

const FULL_SIZE = { width: 144, height: 144 };
const MINI_SIZE = { width: 96, height: 96 };
const EDGE_THRESHOLD = 30;
const PEEK_THRESHOLD = 20;

const currentWindow = getCurrentWindow();

export interface UseRobotWindowReturn {
  isMiniMode: Ref<boolean>;
  isPeeking: Ref<boolean>;
  /** Get the saved pre-mini position (or null if never entered mini
   * mode). */
  preMiniPosition: Ref<{ x: number; y: number } | null>;
  /** Enter mini mode (no-op if already in mini). Resizes + repositions
   * the window to the right edge. */
  enterMiniMode: () => Promise<void>;
  /** Re-check the window's screen position and enter mini mode if
   * it's near the right edge. Called on `tauri://move`. */
  checkEdgeSnap: () => Promise<void>;
  /** Pointer-down handler for the hit-zone. The caller binds it via
   * `useEventListener(hitZoneRef, "pointerdown", onHitZonePointerDown)`. */
  onHitZonePointerDown: (e: PointerEvent) => void;
  /** Mouse-move handler. Triggers peek when the cursor is within
   * PEEK_THRESHOLD of the right screen edge. The caller binds it via
   * `useEventListener(document, "mousemove", onMouseMove)`. */
  onMouseMove: (e: MouseEvent) => void;
}

async function getScaleFactor(): Promise<number> {
  try {
    const monitor = await currentMonitor();
    if (monitor && monitor.scaleFactor) return monitor.scaleFactor;
  } catch (err) {
    console.warn("[useRobotWindow] getScaleFactor failed:", err);
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
    console.warn("[useRobotWindow] currentMonitor failed:", err);
  }
  return { width: window.screen.width, height: window.screen.height };
}

async function getLogicalWindowPos(): Promise<{ x: number; y: number }> {
  const pos = await currentWindow.outerPosition();
  const scale = await getScaleFactor();
  return { x: Math.round(pos.x / scale), y: Math.round(pos.y / scale) };
}

export function useRobotWindow(): UseRobotWindowReturn {
  // Replaces the bare `let` that used to live in RobotRoot.vue's
  // <script setup> — those were never reactive, which meant peek
  // toggles didn't trigger any view update. As Refs, they observe.
  const isMiniMode = ref(false);
  const isPeeking = ref(false);
  const preMiniPosition = ref<{ x: number; y: number } | null>(null);

  async function enterMiniMode(): Promise<void> {
    if (isMiniMode.value) return;
    isMiniMode.value = true;
    console.log("[useRobotWindow] entering mini mode");

    try {
      const pos = await getLogicalWindowPos();
      if (preMiniPosition.value === null) {
        preMiniPosition.value = { x: pos.x, y: pos.y };
        console.log("[useRobotWindow] pre-mini pos (logical):", preMiniPosition.value);
      }
    } catch (err) {
      console.warn("[useRobotWindow] failed to get position:", err);
    }

    try {
      const screenSize = await getScreenSize();
      if (!screenSize) return;

      const newX = screenSize.width - MINI_SIZE.width;
      const newY = preMiniPosition.value?.y ?? 100;
      await currentWindow.setSize(new LogicalSize(MINI_SIZE.width, MINI_SIZE.height));
      await currentWindow.setPosition(new LogicalPosition(newX, newY));
    } catch (err) {
      console.warn("[useRobotWindow] resize failed:", err);
      isMiniMode.value = false;
    }
  }

  async function checkEdgeSnap(): Promise<void> {
    try {
      const pos = await getLogicalWindowPos();
      const screenSize = await getScreenSize();
      if (!screenSize) return;
      const distToRight = screenSize.width - (pos.x + FULL_SIZE.width);
      if (distToRight < EDGE_THRESHOLD && !isMiniMode.value) {
        await enterMiniMode();
      }
    } catch (err) {
      console.warn("[useRobotWindow] edge check failed:", err);
    }
  }

  function onHitZonePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    // The hit-zone ref is owned by the caller (the <div> lives in
    // RobotRoot.vue's template). We bind setPointerCapture there too;
    // this handler just kicks off the OS-level drag.
    currentWindow.startDragging().catch((err) => {
      console.error("[useRobotWindow] startDragging failed:", err);
    });
  }

  function onMouseMove(e: MouseEvent): void {
    if (!isMiniMode.value) return;
    const screenW = window.screen.width;
    const distToRight = screenW - e.screenX;
    const shouldPeek = distToRight < PEEK_THRESHOLD;
    if (shouldPeek !== isPeeking.value) {
      isPeeking.value = shouldPeek;
      void (async () => {
        const size = shouldPeek ? FULL_SIZE : MINI_SIZE;
        const screenSize = await getScreenSize();
        const newX = screenSize.width - size.width;
        const newY = preMiniPosition.value?.y ?? 100;
        try {
          await currentWindow.setSize(new LogicalSize(size.width, size.height));
          await currentWindow.setPosition(new LogicalPosition(newX, newY));
        } catch (err) {
          console.warn("[useRobotWindow] peek resize failed:", err);
        }
      })();
    }
  }

  return {
    isMiniMode,
    isPeeking,
    preMiniPosition,
    enterMiniMode,
    checkEdgeSnap,
    onHitZonePointerDown,
    onMouseMove,
  };
}