<script setup lang="ts">
// src/bubble/BubbleShellRoot.vue — Top-level dispatcher + state holder.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// State:
//   - queue: ref<PermissionRequest[]> (FIFO)
//   - shellMode: 'idle' | 'pill' | 'panel' (derived from registry)
//   - current: computed<PermissionRequest | null> (queue[0])
//   - isTransitioning: ref<boolean> (keyboard/click lock during transitions)
//
// Architecture:
//   - Idle state → render <BubbleIdle />
//   - Pill state → render <PillShell /> (SideEffect kind)
//   - Panel state → render <PanelShell /> (Elicitation | PlanReview kind)
//
// ADR-0018 Stage B PR2: kind-aware decisions (which shell to render;
// how to assemble the canonical PermissionDecision) flow through
// `permissionRegistry[req.kind]` (registry.ts). The local
// PermissionDecision literal that used to live in submitDecision +
// the timeout handler is gone.

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useThrottleFn, useTimeoutFn, useResizeObserver } from "@vueuse/core";
import type {
  ElicitationRequest,
  PermissionRequest,
  PlanReviewRequest,
  SideEffectRequest,
} from "../types/permission";
import {
  decideShellMode,
  buildReply,
  type ReplyPick,
} from "../permission/registry";
import { useBubblePolicy } from "../permission/bubble-policy";
import { EVENTS } from "@/types/events";
import BubbleIdle from "./BubbleIdle.vue";
import PillShell from "./PillShell.vue";
import PanelShell from "./PanelShell.vue";

const PILL_WIDTH = 280;
const PANEL_WIDTH = 600;

const queue = ref<PermissionRequest[]>([]);
const current = computed<PermissionRequest | null>(() => queue.value[0] ?? null);
const isTransitioning = ref(false);
const isHiding = ref(false); // True during the 250ms permission-hide fade-out

type ShellMode = "idle" | "pill" | "panel";

const shellMode = computed<ShellMode>(() => {
  const r = current.value;
  if (!r) return "idle";
  return decideShellMode(r);
});

// Window resize: call set_bubble_size IPC based on shellMode.
// The bubble window is content-sized — we compute the target size
// from shellMode and let the CSS handle the visual layout.
const PILL_COMPACT_HEIGHT = 60;
const PILL_EXPANDED_HEIGHT = 420;
const PANEL_HEIGHT = 400;

const isPillExpanded = ref(false);

function getTargetSize() {
  if (shellMode.value === "idle") return { w: 0, h: 0 };
  if (shellMode.value === "pill") {
    return { w: PILL_WIDTH, h: isPillExpanded.value ? PILL_EXPANDED_HEIGHT : PILL_COMPACT_HEIGHT };
  }
  return { w: PANEL_WIDTH, h: PANEL_HEIGHT };
}

const scheduleIpcResize = useThrottleFn(async () => {
  if (!current.value) return;
  const { w, h } = getTargetSize();
  try {
    await invoke("set_bubble_size", { width: w, height: h });
  } catch (err) {
    console.error("[bubble] set_bubble_size failed:", err);
  }
}, 100);

watch(shellMode, () => { nextTick(() => scheduleIpcResize()); });
watch(current, () => { nextTick(() => scheduleIpcResize()); });
watch(isPillExpanded, () => { nextTick(() => scheduleIpcResize()); });

let unlistenRequest: UnlistenFn | undefined;
let unlistenTimeout: UnlistenFn | undefined;

// Per-kind autoClose policy from settings. Rust 5-min timeout is safety net;
// this is a UX nicety that fires earlier if the user opts in.
const currentKind = computed(() => current.value?.kind ?? null);
const policy = useBubblePolicy(currentKind.value ?? "SideEffect");

const { start: armAutoClose, stop: cancelAutoClose } = useTimeoutFn(
  () => {
    // Timer fired — bubble didn't get user input, auto-dismiss
    submitDecision("deny", { message: "Bubble auto-closed after user idle" });
  },
  () => policy.value.autoCloseMs,
  { immediate: false },
);

async function submitDecision(
  behavior: "allow" | "deny",
  pick: Omit<ReplyPick, "behavior"> = {},
) {
  const r = current.value;
  if (!r || isTransitioning.value) return;
  isTransitioning.value = true;
  cancelAutoClose(); // User responded; cancel autoClose timer
  const decision = buildReply(r, { behavior, ...pick });
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
  }
  queue.value = queue.value.filter((q) => q.requestId !== r.requestId);
  isTransitioning.value = false;
}

watch(current, async (r) => {
  // Reset hide-flag when a new request arrives so the fade-in plays
  isHiding.value = false;
  cancelAutoClose(); // Cancel previous timer
  if (!r) {
    await getCurrentWebviewWindow().hide();
    return;
  }
  // Restart autoClose timer if policy enabled
  if (policy.value.enabled) {
    armAutoClose();
  }
  await getCurrentWebviewWindow().show();
  await getCurrentWebviewWindow().setFocus();
});

onMounted(async () => {
  unlistenRequest = await listen<PermissionRequest>(EVENTS.PERMISSION_REQUEST, (e) => {
    queue.value.push(e.payload);
  });

  // Timeout: Rust already removed the entry, synthesised the deny,
  // responded to the agent, and hidden the bubble window. The TS
  // side's only job is to clean the local queue. No IPC back to
  // Rust — the previous `respond_permission` call here was a no-op
  // (entry already gone) whose only effect was to re-hide the
  // bubble (now done by Rust directly). See `http_server.rs`'s
  // timeout branch and ADR-0013 决策 8.
  unlistenTimeout = await listen<{ request_id: string }>(
    EVENTS.PERMISSION_TIMEOUT,
    (e) => {
      queue.value = queue.value.filter((q) => q.requestId !== e.payload.request_id);
    },
  );

  // permission-hide: Rust emits this before hiding the webview.
  // We set isHiding so the <Transition> plays a 250ms fade-out
  // animation before the window actually disappears.
  await listen(EVENTS.PERMISSION_HIDE, () => {
    isHiding.value = true;
  });
});

// ── Renderer-driven height reporting ─────────────────────────────
// The bubble webview's content height varies with the active shell
// (PillShell ~60pt compact, ToolPillContent ~420pt expanded, etc.).
// We observe the body element and tell Rust to resize the webview to
// match, preserving the current width.

const bubbleBody = ref<HTMLElement | null>(null);

const reportHeight = useThrottleFn((height: number) => {
  invoke("report_bubble_height", { height }).catch((err) => {
    // Silent: report failures are non-fatal
    console.warn("report_bubble_height failed", err);
  });
}, 100);

useResizeObserver(bubbleBody, ([entry]) => {
  const height = entry.contentRect.height;
  if (height > 0) {
    reportHeight(height);
  }
});

onUnmounted(() => {
  unlistenRequest?.();
  unlistenTimeout?.();
});
</script>

<template>
  <div ref="bubbleBody" class="w-full h-full bg-transparent pointer-events-auto flex justify-center items-start overflow-hidden">
    <Transition
      enter-from-class="opacity-0 translate-x-4"
      enter-active-class="transition duration-200 ease-out"
      enter-to-class="opacity-100 translate-x-0"
      leave-from-class="opacity-100"
      leave-active-class="transition duration-[250ms] ease-in"
      leave-to-class="opacity-0"
    >
      <BubbleIdle v-if="shellMode === 'idle'" key="idle" />
    </Transition>
    <Transition
      enter-from-class="opacity-0 translate-x-4"
      enter-active-class="transition duration-200 ease-out"
      enter-to-class="opacity-100 translate-x-0"
      leave-from-class="opacity-100"
      leave-active-class="transition duration-[250ms] ease-in"
      leave-to-class="opacity-0"
    >
      <PillShell
        v-if="shellMode === 'pill' && !isHiding"
        key="pill"
        :request="(current as SideEffectRequest)"
        @allow="submitDecision('allow', { updatedPermissions: $event })"
        @deny="submitDecision('deny', { message: $event })"
        @expand="isPillExpanded = true"
        @collapse="isPillExpanded = false"
      />
    </Transition>
    <Transition
      enter-from-class="opacity-0 translate-x-4"
      enter-active-class="transition duration-200 ease-out"
      enter-to-class="opacity-100 translate-x-0"
      leave-from-class="opacity-100"
      leave-active-class="transition duration-[250ms] ease-in"
      leave-to-class="opacity-0"
    >
      <PanelShell
        v-if="shellMode === 'panel' && !isHiding"
        key="panel"
        :request="(current as ElicitationRequest | PlanReviewRequest)"
        @allow="submitDecision('allow', { updatedInput: $event })"
        @deny="submitDecision('deny', { message: $event })"
      />
    </Transition>
  </div>
</template>
