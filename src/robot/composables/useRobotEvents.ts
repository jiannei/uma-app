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
// production. The call sites for the dev listeners come from
// `setupDevListeners` in dev-listeners.ts (the helper has no DEV
// gate itself).
//
// Design: the composable takes callbacks for each listener rather
// than reaching back into useDisplayState / useRobotWindow / etc.
// directly. That keeps it free of inter-composable coupling. The
// orchestrator (RobotRoot.vue) wires the callbacks at the call
// site, which is where cross-composable rules live.

import { onMounted, onUnmounted } from "vue";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { EVENTS } from "@/types/events";
import { setupDevListeners, type DebugStylePatch } from "../dev-listeners";
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
  onDebugStyle: (patch: DebugStylePatch) => void;
}

export function useRobotEvents(deps: UseRobotEventsDeps): void {
  const unsubs: UnlistenFn[] = [];

  onMounted(async () => {
    unsubs.push(
      await listen(EVENTS.THEME_UPDATED, (e) => {
        const themeId = (e.payload as { theme?: string })?.theme;
        if (themeId) deps.onThemeUpdated(themeId);
      }),
    );

    unsubs.push(
      await listen(EVENTS.AGENT_HOOK, (e) => {
        deps.onAgentHook(e.payload as HookEvent);
      }),
    );

    // tauri://move is a Tauri built-in (not an app-defined channel)
    // and intentionally not in the EVENTS registry — see the
    // comment at the top of src/types/events.ts.
    unsubs.push(
      await listen("tauri://move", () => {
        deps.onWindowMove();
      }),
    );

    if (import.meta.env.DEV) {
      unsubs.push(
        ...(await setupDevListeners({
          sendSynthetic: deps.onSyntheticEvent,
          reset: deps.onReset,
          applyDebugStyle: deps.onDebugStyle,
        })),
      );
    }
  });

  onUnmounted(() => {
    for (const u of unsubs) u();
    unsubs.length = 0;
  });
}