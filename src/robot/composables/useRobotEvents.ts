// src/robot/composables/useRobotEvents.ts — Wire the 6 Tauri event
// listeners the robot window subscribes to.
//
//   - EVENTS.THEME_UPDATED       (dev panel Save → theme reload)
//   - EVENTS.AGENT_HOOK          (HTTP server → DisplayStateResolver)
//   - EVENTS.DEV.SYNTHETIC_EVENT (dev panel → resolver test scenarios)
//   - EVENTS.DEV.RESET           (any source → resolver reset)
//   - EVENTS.DEV.ROBOT_DEBUG_STYLE (dev panel → CSS debug vars)
//   - tauri://move               (Tauri built-in → edge-snap + hit-zone)
//
// Per ADR-0019 Stage B the 3 dev-only listeners are gated inside
// this composable by `import.meta.env.DEV` so Vite DCEs them in
// production. After the `useTauriEvents` deepening, the 5 registry
// events go through the helper and the 3 dev-only entries are
// conditionally spread so production builds don't subscribe to
// channels the dev panel never emits.
//
// `tauri://move` is a Tauri built-in (not an app-defined channel)
// and intentionally not in the EVENTS registry — see the comment
// at the top of src/types/events.ts. It keeps a direct `listen()`
// call below the helper call.
//
// Design: the composable takes callbacks for each listener rather
// than reaching back into useDisplayState / useRobotWindow / etc.
// directly. That keeps it free of inter-composable coupling. The
// orchestrator (RobotRoot.vue) wires the callbacks at the call
// site, which is where cross-composable rules live.

import { onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EVENTS } from "@/types/events";
import {
  EventPayloadMap,
  useTauriEvents,
} from "@/composables/useTauriEvents";
import type { HookEvent } from "../display-state-types";

export interface UseRobotEventsDeps {
  /** Forward an agent hook event into the resolver. */
  onAgentHook: (event: HookEvent) => void;
  /** Dev panel saved a theme.json. */
  onThemeUpdated: (themeId: string) => void;
  /** Window moved — check edge-snap, recompute hit-zone. */
  onWindowMove: () => void;

  // Dev-only callbacks (only invoked in DEV builds):
  onSyntheticEvent: (event: HookEvent) => void;
  onReset: () => void;
  onDebugStyle: (patch: {
    windowBg?: string;
    spriteBg?: string;
    hitzoneBg?: string;
  }) => void;
}

export function useRobotEvents(deps: UseRobotEventsDeps): void {
  // The dev-only entries live in a separate map so production builds
  // DCE them entirely. The prod map goes through the helper directly.
  useTauriEvents<EventPayloadMap>({
    [EVENTS.THEME_UPDATED]: (p) => {
      if (p.theme) deps.onThemeUpdated(p.theme);
    },
    [EVENTS.AGENT_HOOK]: (event) => deps.onAgentHook(event),
  });

  if (import.meta.env.DEV) {
    useTauriEvents<EventPayloadMap>({
      [EVENTS.DEV.SYNTHETIC_EVENT]: (p) => {
        if (p.event) deps.onSyntheticEvent(p.event);
      },
      [EVENTS.DEV.RESET]: () => deps.onReset(),
      [EVENTS.DEV.ROBOT_DEBUG_STYLE]: (p) => deps.onDebugStyle(p),
    });
  }

  // tauri://move is a Tauri built-in (not an app-defined channel)
  // and intentionally not in the EVENTS registry — see the comment
  // at the top of src/types/events.ts. It keeps a direct listen
  // call rather than going through the helper.
  let unlistenMove: UnlistenFn | undefined;
  onMounted(async () => {
    unlistenMove = await listen("tauri://move", () => {
      deps.onWindowMove();
    });
  });
  onUnmounted(() => {
    unlistenMove?.();
  });
}