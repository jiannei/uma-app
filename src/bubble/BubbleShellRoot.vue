<script setup lang="ts">
// src/bubble/BubbleShellRoot.vue — Top-level dispatcher + state holder.
// Spec: docs/superpowers/specs/2026-07-01-bubble-display-design.md
//
// State:
//   - queue: ref<PermissionRequest[]> (FIFO)
//   - current: computed<PermissionRequest | null> (queue[0])
//   - isTransitioning: ref<boolean> (keyboard/click lock during transitions)
//
// Architecture (Phase 3 — unified shell):
//   - queue empty → window.hide()
//   - queue non-empty → render <UnifiedBubbleCard :request="current" />
//     (UnifiedBubbleCard dispatches by kind internally; see UnifiedBubbleCard.vue)
//
// ADR-0018 Stage B: kind-aware decisions flow through
// `permissionRegistry[req.kind]`. The local PermissionDecision literal
// that used to live in submitDecision is gone; buildReply handles it.

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useThrottleFn, useTimeoutFn, useResizeObserver } from "@vueuse/core";
import type { PermissionRequest } from "../types/permission";
import { buildReply, type ReplyPick } from "../permission/registry";
import { useBubblePolicy } from "../permission/bubble-policy";
import { EVENTS } from "@/types/events";
import UnifiedBubbleCard from "./UnifiedBubbleCard.vue";

// Unified shell geometry (Phase 3 — single width, content-sized height).
// The bubble's visual size is now driven by UnifiedBubbleCard's CSS
// (--bubble-width / --bubble-min-height / --bubble-max-height in bubble.css).
// IPC reports the natural body height so the Tauri window can follow.
const BUBBLE_WIDTH = 360;

const queue = ref<PermissionRequest[]>([]);
const current = computed<PermissionRequest | null>(() => queue.value[0] ?? null);
const isTransitioning = ref(false);
const isHiding = ref(false); // True during the 250ms permission-hide fade-out

// Window resize: call set_bubble_size IPC when current changes.
// Width is fixed at 360pt (unified shell). Height is content-driven —
// BubbleShellRoot no longer computes it; the webview reports natural
// height via useResizeObserver (below). We still call set_bubble_size
// on queue transitions to reset the window to idle size.
function getTargetSize() {
  if (!current.value) return { w: 0, h: 0 };
  return { w: BUBBLE_WIDTH, h: 80 }; // min height; body reports real height
}

const scheduleIpcResize = useThrottleFn(async () => {
  if (!current.value) {
    try {
      await invoke("set_bubble_size", { width: 0, height: 0 });
    } catch (err) {
      console.error("[bubble] set_bubble_size failed:", err);
    }
    return;
  }
  const { w, h } = getTargetSize();
  try {
    await invoke("set_bubble_size", { width: w, height: h });
  } catch (err) {
    console.error("[bubble] set_bubble_size failed:", err);
  }
}, 100);

watch(current, () => {
  nextTick(() => scheduleIpcResize());
});

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
  // Intentionally do NOT call setFocus() — the user is often typing
  // in terminal / editor when a permission request arrives. Stealing
  // focus interrupts their keystroke. The bubble shows visually and
  // can be clicked to focus, but the bubble never grabs focus on
  // its own.
});

onMounted(async () => {
  unlistenRequest = await listen<PermissionRequest>(
    EVENTS.PERMISSION_REQUEST,
    (e) => {
      // Defensive dedupe: if Rust ever double-emits the same
      // requestId (e.g. from a future `bubble_win.emit + app.emit`
      // regression), don't push twice. Symptom of double-push was
      // "first Deny removes one copy, second is stuck in the queue
      // forever and blocks subsequent bubbles."
      if (queue.value.some((q) => q.requestId === e.payload.requestId)) {
        return;
      }
      queue.value.push(e.payload);
    },
  );

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
      queue.value = queue.value.filter(
        (q) => q.requestId !== e.payload.request_id,
      );
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
// The bubble webview's content height varies with the unified card's
// body (SideEffect / Elicitation / PlanReview bodies differ). We
// observe the card element directly (via UnifiedBubbleCard's exposed
// cardRef) so the reported height reflects actual content, not the
// window's current constraint. Tell Rust to resize the webview to match.
const bubbleBody = ref<HTMLElement | null>(null);
const cardInstance = ref<InstanceType<typeof UnifiedBubbleCard> | null>(null);

const reportHeight = useThrottleFn((height: number) => {
  invoke("report_bubble_height", { height }).catch((err) => {
    // Silent: report failures are non-fatal
    console.warn("report_bubble_height failed", err);
  });
}, 50);

// Watch both the wrapper and the card ref; report whichever has real content.
useResizeObserver(bubbleBody, ([entry]) => {
  const height = entry.contentRect.height;
  if (height > 0) {
    reportHeight(height);
  }
});

watch(cardInstance, async (inst) => {
  await nextTick();
  const cardEl = inst?.cardRef;
  if (!cardEl) return;
  const observer = new ResizeObserver(([entry]) => {
    if (entry.contentRect.height > 0) {
      reportHeight(entry.contentRect.height);
    }
  });
  observer.observe(cardEl);
  // Store observer to clean up when card changes
  (bubbleBody as any)._cardObserver = observer;
});

onUnmounted(() => {
  if ((bubbleBody as any)._cardObserver) {
    (bubbleBody as any)._cardObserver.disconnect();
  }
});

onUnmounted(() => {
  unlistenRequest?.();
  unlistenTimeout?.();
});
</script>

<template>
  <!-- Content-driven height: wrapper has no height constraint so the
       card's natural size is reported via ResizeObserver. overflow-hidden
       is dropped from the wrapper — Tauri window is transparent, so any
       overflow would just paint onto the desktop (which we avoid by
       sizing the window to the card via report_bubble_height). -->
  <div
    ref="bubbleBody"
    class="w-full bg-transparent pointer-events-auto flex justify-center items-start"
  >
    <!-- spring easing + 60pt slide (uma-pet bubble.css .card transition) -->
    <Transition
      enter-from-class="opacity-0 translate-x-16"
      enter-active-class="transition duration-[350ms] ease-[var(--ease-spring)]"
      enter-to-class="opacity-100 translate-x-0"
      leave-from-class="opacity-100"
      leave-active-class="transition duration-[250ms] ease-in"
      leave-to-class="opacity-0"
    >
      <UnifiedBubbleCard
        v-if="current && !isHiding"
        key="card"
        ref="cardInstance"
        :request="current"
        @allow="submitDecision('allow', $event)"
        @deny="submitDecision('deny', { message: $event })"
      />
    </Transition>
  </div>
</template>