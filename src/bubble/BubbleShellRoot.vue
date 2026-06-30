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
import { useThrottleFn } from "@vueuse/core";
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
import { EVENTS } from "@/types/events";
import BubbleIdle from "./BubbleIdle.vue";
import PillShell from "./PillShell.vue";
import PanelShell from "./PanelShell.vue";

const PILL_WIDTH = 280;
const PANEL_WIDTH = 600;

const queue = ref<PermissionRequest[]>([]);
const current = computed<PermissionRequest | null>(() => queue.value[0] ?? null);
const isTransitioning = ref(false);

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

async function submitDecision(
  behavior: "allow" | "deny",
  pick: Omit<ReplyPick, "behavior"> = {},
) {
  const r = current.value;
  if (!r || isTransitioning.value) return;
  isTransitioning.value = true;
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
  if (!r) {
    await getCurrentWebviewWindow().hide();
    return;
  }
  await getCurrentWebviewWindow().show();
  await getCurrentWebviewWindow().setFocus();
});

onMounted(async () => {
  unlistenRequest = await listen<PermissionRequest>(EVENTS.PERMISSION_REQUEST, (e) => {
    queue.value.push(e.payload);
  });

  unlistenTimeout = await listen<{ request_id: string }>(
    EVENTS.PERMISSION_TIMEOUT,
    async (e) => {
      const reqId = e.payload.request_id;
      const r = queue.value.find((q) => q.requestId === reqId);
      if (!r || isTransitioning.value) return;
      isTransitioning.value = true;
      const decision = buildReply(r, {
        behavior: "deny",
        message: "Request timed out",
      });
      try {
        await invoke("respond_permission", { decision });
      } catch (err) {
        console.error("[bubble] timeout respond_permission failed:", err);
      } finally {
        isTransitioning.value = false;
      }
      queue.value = queue.value.filter((q) => q.requestId !== reqId);
    },
  );
});

onUnmounted(() => {
  unlistenRequest?.();
  unlistenTimeout?.();
});
</script>

<template>
  <div class="w-full h-full bg-transparent pointer-events-auto flex justify-center items-start overflow-hidden">
    <BubbleIdle v-if="shellMode === 'idle'" />
    <PillShell
      v-else-if="shellMode === 'pill'"
      :request="(current as SideEffectRequest)"
      @allow="submitDecision('allow', { updatedPermissions: $event })"
      @deny="submitDecision('deny', { message: $event })"
      @expand="isPillExpanded = true"
      @collapse="isPillExpanded = false"
    />
    <PanelShell
      v-else-if="shellMode === 'panel'"
      :request="(current as ElicitationRequest | PlanReviewRequest)"
      @allow="submitDecision('allow', { updatedInput: $event })"
      @deny="submitDecision('deny', { message: $event })"
    />
  </div>
</template>
