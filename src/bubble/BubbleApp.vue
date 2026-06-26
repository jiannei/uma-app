<script setup lang="ts">
// src/bubble/BubbleApp.vue — 权限气泡顶层 dispatcher（v5 + v6 轻改）。
//
// **单容器**：整个 webview 是一个大圆角矩形，pill 永远在顶，expanded
// 条件显示。**没有 1px 分隔线**（v4 修订）。
//
// **弹性高度**：
// - Elicitation: min 200pt / max 500pt
// - PlanReview: min 280pt / max 700pt
// - SideEffect: 只 pill（不展开）
//
// **位置**：`Position::TopCenter` + 8pt y（Rust 端固定）。
//
// **决策**：pill 永远提供主操作（SideEffect/PlanReview = ✓+✗，Elicitation
// = →+X）。Elicitation 子组件维护自己的状态，pill 决策时通过
// `defineExpose` 读子组件状态构造 PermissionDecision。

import { ref, onMounted, onUnmounted, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  PermissionDecision,
  PermissionRequest,
  SideEffectRequest,
  ElicitationRequest,
  PlanReviewRequest,
} from "../types/permission";
import { useBubbleLang } from "./lang";
import BubblePill from "./BubblePill.vue";
import SideEffectBubble from "./SideEffectBubble.vue";
import ElicitationBubble from "./ElicitationBubble.vue";
import PlanReviewBubble from "./PlanReviewBubble.vue";

type View = "collapsed" | "expanded";

const lang = useBubbleLang();

const BUBBLE_WIDTH = 280;
const PILL_HEIGHT = 80;
const EXPANDED_BOUNDS: Record<string, [number, number]> = {
  Elicitation: [200, 500],
  PlanReview: [280, 700],
};

async function setBubbleHeight(height: number) {
  try {
    await invoke("set_bubble_size", { width: BUBBLE_WIDTH, height });
  } catch (err) {
    console.error("[bubble] set_bubble_size failed:", err);
  }
}

const queue = ref<PermissionRequest[]>([]);
const current = computed<PermissionRequest | null>(() => queue.value[0] ?? null);
const view = ref<View>("collapsed");
let unlisten: UnlistenFn | undefined;
let unlistenTimeout: UnlistenFn | undefined;

const elicitationRef = ref<InstanceType<typeof ElicitationBubble> | null>(null);
const planReviewRef = ref<InstanceType<typeof PlanReviewBubble> | null>(null);

const elicitationRequest = computed<ElicitationRequest | null>(() => {
  const r = current.value;
  return r && r.kind === "Elicitation" ? (r as ElicitationRequest) : null;
});
const planReviewRequest = computed<PlanReviewRequest | null>(() => {
  const r = current.value;
  return r && r.kind === "PlanReview" ? (r as PlanReviewRequest) : null;
});

const expandedEl = ref<HTMLElement | null>(null);
let resizeObserver: ResizeObserver | null = null;

async function show() {
  try {
    await getCurrentWebviewWindow().show();
    await getCurrentWebviewWindow().setFocus().catch(() => {});
  } catch (err) {
    console.error("[bubble] show failed:", err);
  }
}
async function hide() {
  try {
    await getCurrentWebviewWindow().hide();
  } catch (err) {
    console.error("[bubble] hide failed:", err);
  }
}

function clampExpandedHeight(kind: string, contentH: number): number {
  const bounds = EXPANDED_BOUNDS[kind];
  if (!bounds) return contentH;
  const [min, max] = bounds;
  return Math.max(min, Math.min(max, contentH));
}

async function syncHeight() {
  const r = current.value;
  if (!r) {
    await setBubbleHeight(PILL_HEIGHT);
    return;
  }
  if (view.value === "collapsed") {
    await setBubbleHeight(PILL_HEIGHT);
    return;
  }
  await nextTick();
  const el = expandedEl.value;
  if (!el) {
    await setBubbleHeight(PILL_HEIGHT);
    return;
  }
  const contentH = el.scrollHeight;
  const expandedH = clampExpandedHeight(r.kind, contentH);
  await setBubbleHeight(PILL_HEIGHT + expandedH);
}

async function onAction() {
  const r = current.value;
  if (!r) return;
  if (r.kind === "Elicitation") {
    elicitationRef.value?.goNextOrSubmit();
    return;
  }
  if (r.kind === "PlanReview") {
    const message = planReviewRef.value?.getFeedback();
    await submitDecision("allow", { message });
    return;
  }
  await submitDecision("allow", {});
}

async function onCancel() {
  const r = current.value;
  if (!r) return;
  if (r.kind === "PlanReview") {
    const message = planReviewRef.value?.getFeedback();
    await submitDecision("deny", { message });
    return;
  }
  await submitDecision("deny", {});
}

async function onElicitationSubmit(updatedInput: unknown) {
  await submitDecision("allow", { updatedInput });
}

async function submitDecision(
  behavior: "allow" | "deny",
  opts: { updatedInput?: unknown; message?: string } = {},
) {
  const r = current.value;
  if (!r) return;
  const decision: PermissionDecision = {
    requestId: r.requestId,
    behavior,
    ...(opts.updatedInput !== undefined ? { updatedInput: opts.updatedInput } : {}),
    ...(opts.message ? { message: opts.message } : {}),
  };
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
  }
  queue.value = queue.value.filter((q) => q.requestId !== r.requestId);
}

async function onPillBodyClick() {
  const r = current.value;
  if (!r) return;
  view.value = view.value === "collapsed" ? "expanded" : "collapsed";
  await syncHeight();
}

watch(current, async (r) => {
  view.value = "collapsed";
  await nextTick();
  if (!r) {
    await hide();
    await setBubbleHeight(PILL_HEIGHT);
    return;
  }
  await show();
  await syncHeight();
});

onMounted(async () => {
  resizeObserver = new ResizeObserver(() => {
    if (view.value === "expanded") syncHeight();
  });

  unlisten = await listen<PermissionRequest>("permission-request", async (e) => {
    queue.value.push(e.payload);
  });

  unlistenTimeout = await listen<{ request_id: string }>(
    "permission-timeout",
    (e) => {
      queue.value = queue.value.filter(
        (r) => r.requestId !== e.payload.request_id,
      );
    },
  );
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
});
onUnmounted(() => {
  unlisten?.();
  unlistenTimeout?.();
});
</script>

<template>
  <div class="bubble-root" :class="{ 'bubble-root--empty': !current }">
    <BubblePill
      v-if="current"
      :request="current"
      :lang="lang"
      :expandable="true"
      :expanded="view === 'expanded'"
      @body-click="onPillBodyClick"
      @action="onAction"
      @cancel="onCancel"
    />

    <div
      v-if="current && view === 'expanded' && current.kind === 'Elicitation' && elicitationRequest"
      ref="expandedEl"
      class="expanded-section"
    >
      <ElicitationBubble
        ref="elicitationRef"
        :request="elicitationRequest"
        @submit="onElicitationSubmit"
      />
    </div>
    <div
      v-else-if="current && view === 'expanded' && current.kind === 'PlanReview' && planReviewRequest"
      ref="expandedEl"
      class="expanded-section"
    >
      <PlanReviewBubble ref="planReviewRef" :request="planReviewRequest" />
    </div>
    <div
      v-else-if="current && view === 'expanded' && current.kind === 'SideEffect'"
      ref="expandedEl"
      class="expanded-section"
    >
      <SideEffectBubble :request="(current as SideEffectRequest)" />
    </div>
    <div
      v-else-if="current && view === 'expanded' && current.kind === 'PlanReview' && planReviewRequest"
      ref="expandedEl"
      class="expanded-section"
    >
      <PlanReviewBubble ref="planReviewRef" :request="planReviewRequest" />
    </div>
  </div>
</template>

<style scoped>
.bubble-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: 22pt;
  background: var(--bubble-bg, rgba(28, 28, 30, 0.78));
  -webkit-backdrop-filter: var(--bubble-backdrop, blur(20px) saturate(180%));
  backdrop-filter: var(--bubble-backdrop, blur(20px) saturate(180%));
  box-shadow: var(--bubble-shadow, 0 4px 16px rgba(0, 0, 0, 0.32));
  pointer-events: none;
  overflow: hidden;
  color: var(--bubble-text, #f5f5f7);
}
.bubble-root--empty {
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.expanded-section {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
