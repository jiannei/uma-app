// src/composables/useTauriEvents.ts — Tauri event subscription helper.
//
// Contract: caller passes a map of {event: handler}. For each entry
// the helper registers a `listen()` during onMounted and tears it
// down on onUnmounted. The handler signature is `(payload: T) => void`
// — the Tauri event wrapper (`event`, `id`) is stripped because no
// current call site reads it. Event names must be `EVENTS.X` constants;
// the map is partial (caller lists only what it cares about); per-key
// payload types are inferred by passing `EventPayloadMap` as the type
// parameter.
//
// Why this exists: four call sites (useSettings, BubbleShellRoot,
// DevToolsApp, useRobotEvents) used to hand-write the same shape —
// `unlisteners.push(await listen(...))` inside onMounted, cleanup
// loop in onUnmounted. The shape is error-prone (forgot to
// unsubscribe → listener leaks; forgot to subscribe →
// LANGUAGE_CHANGE-style half-dead events) and the boilerplate
// dominated the files. The helper makes "remember to subscribe" a
// function-signature contract and the lifecycle is handled once.
//
// `LANGUAGE_CHANGE` was the canonical bug — a release shipped
// without the TS listener because there was no compiler hint that
// the event was unhandled. After this helper, an unhandled event
// is just an absent map key; the call site reads as documentation
// of which events this component cares about.

import { onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { EVENTS } from "@/types/events";
import type { HookEvent } from "@/robot/display-state-types";
import type { PermissionRequest } from "@/types/permission";

/**
 * Maps each prod + dev event wire string to its payload type. Pass
 * this to `useTauriEvents<EventPayloadMap>({...})` to get type-safe
 * handlers per event. Keep in sync with `src/types/events.ts` and
 * `src-tauri/src/events.rs` — the wire strings are the source of
 * truth; the payload shapes mirror the Rust emit sites.
 */
export interface EventPayloadMap {
  // ── Prod channels ──
  [EVENTS.AGENT_HOOK]: HookEvent;
  [EVENTS.PERMISSION_REQUEST]: PermissionRequest;
  [EVENTS.PERMISSION_TIMEOUT]: { request_id: string };
  [EVENTS.PERMISSION_HIDE]: void;
  [EVENTS.THEME_CHANGE]: { theme: string };
  [EVENTS.THEME_UPDATED]: { theme?: string };
  [EVENTS.DND_CHANGE]: { dnd: boolean };
  [EVENTS.SOUND_CHANGE]: { sound_enabled: boolean };
  [EVENTS.LANGUAGE_CHANGE]: { language: string };
  [EVENTS.AUTO_START_CHANGE]: { auto_start: boolean };

  // ── Dev-only channels ──
  [EVENTS.DEV.PENDING_CHANGED]: void;
  [EVENTS.DEV.SYNTHETIC_EVENT]: { event?: HookEvent };
  [EVENTS.DEV.RESET]: Record<string, never>;
  [EVENTS.DEV.ROBOT_DEBUG_STYLE]: {
    windowBg?: string;
    spriteBg?: string;
    hitzoneBg?: string;
  };
}

/**
 * Subscribe to a set of Tauri events for the lifetime of the calling
 * component. Each entry in `handlers` is registered during onMounted
 * and torn down during onUnmounted. Handlers receive only the typed
 * payload (not the Tauri `Event<T>` wrapper). The map is partial —
 * only the keys you list are subscribed.
 *
 * The `M` type parameter is inferred from the argument shape; pass
 * `EventPayloadMap` to get per-key payload types from the helper's
 * own registry.
 *
 * Example:
 *   useTauriEvents<EventPayloadMap>({
 *     [EVENTS.THEME_CHANGE]: (payload) => { ... },
 *     [EVENTS.DND_CHANGE]: (payload) => { ... },
 *   });
 */
export function useTauriEvents<M>(
  handlers: { [K in keyof M]?: (payload: M[K]) => void },
): void {
  const unlisteners: UnlistenFn[] = [];
  // Race guard: if the component unmounts before `listen()` resolves
  // (e.g. fast tab switches, settings panel close), the await would
  // otherwise push a stale unlistener onto an array that onUnmounted
  // has already walked. Setting `cancelled` first means the post-await
  // check disposes the listener immediately instead of leaking.
  let cancelled = false;

  onMounted(async () => {
    for (const event of Object.keys(handlers) as (keyof M & string)[]) {
      if (cancelled) return;
      const handler = handlers[event];
      if (!handler) continue;
      const unlisten = await listen<M[typeof event]>(
        event,
        (e) => handler(e.payload),
      );
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    }
  });

  onUnmounted(() => {
    cancelled = true;
    for (const u of unlisteners) u();
    unlisteners.length = 0;
  });
}
