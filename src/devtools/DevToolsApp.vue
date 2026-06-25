<script setup lang="ts">
// src/devtools/DevToolsApp.vue — DevTools parent SFC.
//
// INDEPENDENT of the robot window. The dev panel has its own XState
// DisplayStateResolver instance (via `useMachine`) and processes raw
// events directly (no round-trip through robot). The robot window is
// reduced to "animation source" — it still runs its own resolver to
// drive the sprite, but the dev panel no longer reads its state.
//
// This makes the dev panel the GROUND TRUTH reference. If you want
// to verify that the robot's resolver is working correctly, you can
// compare its sprite (animation) against the dev panel's computed
// state visually. If they diverge, the bug is in the robot.
//
// Per ADR-0006 §Decision, both instances use `useMachine(displayStateResolver,
// { input: { theme } })` — same machine definition, same Vue
// composable → behavior equivalence guarantee.
//
// See docs/adr/0005-dev-tools.md D11 for the broader dev-tools
// architecture.

import { ref, watch, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn, emit as tauriEmit } from "@tauri-apps/api/event";
import { useMachine } from "@xstate/vue";
import { displayStateResolver } from "../robot/display-state-resolver";
import { DEFAULT_THEME } from "../robot/display-state-constants";
import type { HookEvent, ThemeManifest } from "../robot/display-state-types";
import type { PermissionRequest } from "../types/permission";
import { Button } from "@/components/ui/button";

import StateMachinePanel from "./panels/StateMachinePanel.vue";
import StoresPanel from "./panels/StoresPanel.vue";
import SyntheticFirePanel from "./panels/SyntheticFirePanel.vue";
import VisualDebugPanel from "./panels/VisualDebugPanel.vue";
import ThemeEditorPanel from "./panels/ThemeEditorPanel.vue";

// ── Local DisplayStateResolver (ground truth for dev panel) ───────
//
// Initializes with DEFAULT_THEME; on mount we fetch the real theme
// and send THEME_CHANGED so timings match the robot window.

const { snapshot: smSnapshot, send } = useMachine(displayStateResolver, {
  input: { theme: DEFAULT_THEME as unknown as ThemeManifest },
});

// `smSnapshot.value.context` is the live MachineSnapshot. Panel 1
// renders from this ref via a thin wrapper ref for type clarity.
const snapshot = ref(smSnapshot.value.context);
watch(
  smSnapshot,
  (s) => {
    snapshot.value = s.context;
  },
  { deep: false },
);

// ── Rust store snapshots (live) ─────────────────────────────────
//
// PendingStore: kept (one pending permission per request, with the
// full canonical PermissionRequest payload so the panel can render
// kind + per-kind fields).
//
// AlwaysAllowStore: REMOVED in ADR-0011 — CC owns session-scoped
// permission rules via destination: "session" entries; we no longer
// keep a parallel cache. See ADR-0003 (archived) for the previous
// per-(agent, session) HashSet<tool_name> shape.

interface PendingEntryView {
  requestId: string;
  agentId: string;
  request: PermissionRequest;
}
const pending = ref<PendingEntryView[]>([]);

async function refreshPending() {
  try {
    pending.value = await invoke<PendingEntryView[]>("devtools_get_pending");
  } catch (err) {
    console.warn("[devtools] devtools_get_pending failed:", err);
  }
}

// ── Agents (for SyntheticFirePanel dropdown) ────────────────────

interface AgentInfo {
  id: string;
  display_name: string;
}
const agents = ref<AgentInfo[]>([]);

// ── Synthetic event fire ────────────────────────────────────────
//
// Feed the local resolver directly (so Panel 1 updates without a
// round trip), and ALSO emit `devtools-synthetic-event` so the robot
// window's sprite reacts.
async function fireSynthetic(event: HookEvent) {
  send({ type: "AGENT_HOOK", event });
  await tauriEmit("devtools-synthetic-event", {
    event,
    synthetic: true,
    source: "devtools",
  });
}

// ── Reset (local resolver + broadcast to robot) ───────────────────

async function resetAll() {
  send({ type: "RESET" });
  await tauriEmit("devtools-reset", {});
}

// ── Lifecycle: subscribe / unsubscribe ──────────────────────────

const unsubscribers: UnlistenFn[] = [];

onMounted(async () => {
  // Fetch agents list (for SyntheticFirePanel dropdown).
  try {
    agents.value = await invoke<AgentInfo[]>("list_agents");
  } catch (err) {
    console.warn("[devtools] list_agents failed:", err);
  }

  // Initial Rust store snapshots.
  await refreshPending();

  // Fetch the active theme manifest so timings match the robot window.
  // `get_settings` returns the current theme id; `theme_load` reads
  // the manifest from disk on the Rust side.
  try {
    const settings = await invoke<{ theme_id?: string }>("get_settings");
    if (settings?.theme_id) {
      const theme = await invoke<ThemeManifest>("theme_load", {
        themeId: settings.theme_id,
      });
      send({ type: "THEME_CHANGED", theme });
    }
  } catch (err) {
    console.warn("[devtools] initial theme load failed:", err);
  }

  // Theme-change broadcasts from the robot window / settings → swap
  // local theme so timing-sensitive operations (sleep sequence,
  // auto-return) match.
  unsubscribers.push(
    await listen("theme-change", async (e) => {
      const themeId = (e.payload as { theme_id?: string })?.theme_id;
      if (!themeId) return;
      try {
        const theme = await invoke<ThemeManifest>("theme_load", {
          themeId,
        });
        send({ type: "THEME_CHANGED", theme });
      } catch (err) {
        console.warn("[devtools] theme_load on theme-change failed:", err);
      }
    }),
  );
  unsubscribers.push(
    await listen("theme-updated", async (e) => {
      const themeId = (e.payload as { theme?: string })?.theme;
      if (!themeId) return;
      try {
        const theme = await invoke<ThemeManifest>("theme_load", {
          themeId,
        });
        send({ type: "THEME_CHANGED", theme });
      } catch (err) {
        console.warn("[devtools] theme_load on theme-updated failed:", err);
      }
    }),
  );

  // Real events from HTTP server → feed local resolver (ground truth
  // state machine). Event log was removed — CLI output covers that.
  unsubscribers.push(
    await listen("agent-hook-event", (e) => {
      const p = e.payload as HookEvent;
      send({ type: "AGENT_HOOK", event: p });
    })
  );

  // Rust store mutations → re-fetch.
  unsubscribers.push(
    await listen("devtools-pending-changed", () => {
      refreshPending();
    })
  );
  // Reset broadcast (from any source — this panel, another dev
  // panel session, or a future trigger). Reset local resolver.
  unsubscribers.push(
    await listen("devtools-reset", () => {
      send({ type: "RESET" });
    })
  );
});

onUnmounted(() => {
  for (const u of unsubscribers) u();
  unsubscribers.length = 0;
});
</script>

<template>
  <div class="flex flex-col h-full bg-background text-foreground">
    <header class="flex items-center justify-between px-3 py-1.5 bg-background border-b border-border">
      <span class="font-semibold text-[12px] tracking-wider text-foreground">Uma DevTools</span>
      <Button variant="destructive" size="sm" @click="resetAll">
        Reset
      </Button>
    </header>
    <main class="flex-1 min-h-0 flex flex-wrap gap-px bg-border">
      <StateMachinePanel :snapshot="snapshot" class="flex-1 min-w-[280px] bg-card overflow-auto" />
      <VisualDebugPanel class="flex-1 min-w-[280px] overflow-auto" />
      <StoresPanel :pending="pending" class="flex-1 min-w-[280px] overflow-auto" />
      <SyntheticFirePanel :agents="agents" :fire-synthetic="fireSynthetic" class="flex-1 min-w-[280px] overflow-auto" />
      <ThemeEditorPanel class="flex-1 min-w-[280px] overflow-auto" />
    </main>
  </div>
</template>