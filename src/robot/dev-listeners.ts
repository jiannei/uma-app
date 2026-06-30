// src/robot/dev-listeners.ts — Wire the 3 dev-only Tauri event
// listeners used by the robot window.
//
//   - EVENTS.DEV.SYNTHETIC_EVENT    (dev panel → resolver)
//   - EVENTS.DEV.RESET              (any source → resolver reset)
//   - EVENTS.DEV.ROBOT_DEBUG_STYLE  (dev panel → CSS debug vars)
//
// Per ADR-0019 Stage B + the events.ts comment, callers gate this
// helper behind `import.meta.env.DEV` so Vite DCEs the call site in
// production. The helper itself has no DEV gate — it's the caller's
// responsibility to skip it.
//
// The XState `send` function and the debug-style mutator are passed
// in as deps so this module stays free of XState and DOM imports.
// RobotRoot.vue owns `send` (via `useMachine`) and the
// `document.documentElement.style.setProperty` calls.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EVENTS } from "@/types/events";
import type { HookEvent } from "./display-state-types";

export interface DebugStylePatch {
  windowBg?: string;
  spriteBg?: string;
  hitzoneBg?: string;
}

export interface DevListenerDeps {
  /** Forward a synthetic HookEvent into the DisplayStateResolver. */
  sendSynthetic(event: HookEvent): void;
  /** Reset the DisplayStateResolver's session / subagent state. */
  reset(): void;
  /** Apply CSS debug variables to the document root. */
  applyDebugStyle(patch: DebugStylePatch): void;
}

/**
 * Wire the 3 dev-only listeners. Returns an array of UnlistenFn
 * handles; the caller is responsible for calling each in its
 * onUnmounted hook (or the helper's caller can push them onto an
 * existing unsubscribers list).
 *
 * The function performs no DEV gate itself — callers wrap the call:
 *
 *   if (import.meta.env.DEV) {
 *     const unsubs = await setupDevListeners({ ... });
 *     unsubscribers.push(...unsubs);
 *   }
 */
export async function setupDevListeners(
  deps: DevListenerDeps,
): Promise<UnlistenFn[]> {
  const unsubs: UnlistenFn[] = [];

  unsubs.push(
    await listen<{ event?: HookEvent }>(EVENTS.DEV.SYNTHETIC_EVENT, (e) => {
      const ev = e.payload?.event;
      if (!ev) return;
      deps.sendSynthetic(ev);
    }),
  );

  unsubs.push(await listen(EVENTS.DEV.RESET, () => deps.reset()));

  unsubs.push(
    await listen<DebugStylePatch>(EVENTS.DEV.ROBOT_DEBUG_STYLE, (e) => {
      deps.applyDebugStyle(e.payload ?? {});
    }),
  );

  return unsubs;
}