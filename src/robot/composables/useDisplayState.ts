// src/robot/composables/useDisplayState.ts — Owns the XState
// DisplayStateResolver subscription.
//
// What lives here:
//   - The `useMachine` call against `displayStateResolver`
//   - A `Ref<DisplayState>` that mirrors `smSnapshot.context.displayState`
//   - The `send` function for callers that want to forward events
//     (useThemeAssets calls send({ type: "THEME_CHANGED", theme }); the
//     future useRobotEvents helper calls send({ type: "AGENT_HOOK",
//     event }); etc.)
//
// What does NOT live here:
//   - Anything that runs when the state changes (sprite refresh, sound
//     play, hit-zone recompute) — those are cross-cutting rules the
//     orchestrator (RobotRoot.vue) wires via `watch(state, ...)`. This
//     composable does not know about them.

import { computed, ref, watch, type Ref } from "vue";
import { useMachine } from "@xstate/vue";
import {
  displayStateResolver,
} from "../display-state-resolver";
import { DEFAULT_THEME } from "../display-state-constants";
import type { DisplayState, ThemeManifest } from "../display-state-types";

export interface UseDisplayStateReturn {
  /** Current display state. Mirrors the XState context; consumers
   * `watch(this)` to react. */
  state: Ref<DisplayState>;
  /** Send an event into the resolver. Accepts the XState event shape
   * directly. */
  send: ReturnType<typeof useMachine<typeof displayStateResolver>>["send"];
  /** Forward a freshly-loaded theme manifest. Thin wrapper over
   * `send({ type: "THEME_CHANGED", theme })` — gives the caller
   * (useThemeAssets) a single-purpose seam. */
  applyTheme: (theme: ThemeManifest) => void;
}

export function useDisplayState(): UseDisplayStateReturn {
  // useMachine must be called with sync input. We start with
  // DEFAULT_THEME and swap to the real theme after mount + on every
  // theme-change. The initial value is acceptable because the
  // orchestrator's `loadInitial()` immediately calls `applyTheme()`.
  const { snapshot, send } = useMachine(displayStateResolver, {
    input: { theme: DEFAULT_THEME as unknown as ThemeManifest },
  });

  // Mirror the XState context into a plain Ref so consumers can
  // `watch(state, ...)` without depending on XState's snapshot type.
  const smDisplayState = computed(() => snapshot.value.context.displayState);
  const state = ref<DisplayState>(smDisplayState.value);
  watch(
    smDisplayState,
    (next) => {
      state.value = next;
    },
    { immediate: true },
  );

  function applyTheme(theme: ThemeManifest): void {
    send({ type: "THEME_CHANGED", theme });
  }

  return { state, send, applyTheme };
}