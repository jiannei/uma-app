<script setup lang="ts">
// src/bubble/BubbleApp.vue — 权限气泡顶层 dispatcher（ADR-0017 收敛版）。
//
// **Webview 自适应**：
// - webview 280×600pt max，Rust 端 window 永远 max=600pt
// - `.bubble-content` content-sized + 背景
// - `motion-v` spring 动画高度（ADR-0015 决策 1 保留）
//
// **架构**：
// - 3 个 kind 通过 `<component :is>` dispatch 到 ToolBubble / AskBubble / PlanBubble
// - 每 kind 暴露不同的 emit 形状：
//   - ToolBubble: "allow" + updatedPermissions? / "deny"
//   - AskBubble:  "submit" + updatedInput / "deny"
//   - PlanBubble: 不 emit（通过 expose canApprove / getFeedback / scrollToBottom）
// - 5min timeout 静默 deny（ADR-0017 Q6），无 AlarmBanner 闪烁

import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useResizeObserver, useThrottleFn } from "@vueuse/core";
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionUpdateEntry,
} from "../types/permission";
import { useBubbleLang } from "./lang";
import BubblePill from "./BubblePill.vue";
import ToolBubble from "./ToolBubble.vue";
import AskBubble from "./AskBubble.vue";
import PlanBubble from "./PlanBubble.vue";

const lang = useBubbleLang();

const BUBBLE_WIDTH = 280;
const PILL_HEIGHT = 48;
const MIN_HEIGHT = 80;
const MAX_HEIGHT = 600;

type View = "collapsed" | "expanded";

const queue = ref<PermissionRequest[]>([]);
const current = computed<PermissionRequest | null>(() => queue.value[0] ?? null);
const view = ref<View>("collapsed");
let unlisten: UnlistenFn | undefined;
let unlistenTimeout: UnlistenFn | undefined;

// Dispatch: kind → component
const expandedComponent = computed(() => {
  const r = current.value;
  if (!r) return null;
  switch (r.kind) {
    case "Elicitation": return AskBubble;
    case "PlanReview": return PlanBubble;
    case "SideEffect": return ToolBubble;
  }
});

type ExpandedMethods = {
  // AskBubble
  goNextOrSubmit?: () => void;
  // PlanBubble
  canApprove?: boolean;
  getFeedback?: () => string;
  scrollToBottom?: () => void;
};

const expandedRef = ref<ExpandedMethods | null>(null);

const contentInnerEl = ref<HTMLElement | null>(null);
const measuredHeight = ref(PILL_HEIGHT);

useResizeObserver(contentInnerEl, (entries) => {
  const h = entries[0]?.contentRect.height;
  if (h && h > 0) measuredHeight.value = h;
});

const scheduleIpcResize = useThrottleFn(async () => {
  if (!current.value) return;
  const h = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(measuredHeight.value)));
  try {
    await invoke("set_bubble_size", { width: BUBBLE_WIDTH, height: h });
  } catch (err) {
    console.error("[bubble] set_bubble_size failed:", err);
  }
}, 16);

async function show() {
  try {
    await getCurrentWebviewWindow().show();
    await getCurrentWebviewWindow().setFocus();
  } catch (err) {
    console.error("[bubble] show failed:", err);
  }
}

async function onBubbleMouseDown() {
  try {
    await getCurrentWebviewWindow().setFocus();
  } catch (err) {
    console.error("[bubble] setFocus failed:", err);
  }
}

async function hide() {
  try {
    await getCurrentWebviewWindow().hide();
  } catch (err) {
    console.error("[bubble] hide failed:", err);
  }
}

const targetHeight = computed<number>(() => {
  if (!current.value) return 0;
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, measuredHeight.value));
});

// === Dispatch: pill 按钮 → kind-aware 决策 ===

// ToolBubble emit "allow" + updatedPermissions?
async function onToolAllow(updatedPermissions?: PermissionUpdateEntry[]) {
  await submitDecision("allow", { updatedPermissions });
}

// AskBubble emit "submit" + updatedInput
async function onAskSubmit(updatedInput: unknown) {
  await submitDecision("allow", { updatedInput });
}

// pill → 按 kind dispatch
async function onAction() {
  const r = current.value;
  if (!r) return;
  if (r.kind === "Elicitation") {
    expandedRef.value?.goNextOrSubmit?.();
    return;
  }
  if (r.kind === "PlanReview") {
    if (!expandedRef.value?.canApprove) {
      expandedRef.value?.scrollToBottom?.();
      return;
    }
    await submitDecision("allow", {});
    return;
  }
  // SideEffect: pill → 等价于 "Allow once"。ToolBubble 内部用按钮列表让用户
  // 选其他 suggestions；pill 上一键 Allow 是最快的"安全默认"。
  await submitDecision("allow", {});
}

async function onCancel() {
  const r = current.value;
  if (!r) return;
  if (r.kind === "PlanReview") {
    const message = expandedRef.value?.getFeedback?.() ?? "";
    await submitDecision("deny", { message });
    return;
  }
  await submitDecision("deny", { message: "User denied" });
}

async function onSkip() {
  await submitDecision("deny", { message: "Skipped" });
}

async function submitDecision(
  behavior: "allow" | "deny",
  opts: { updatedInput?: unknown; updatedPermissions?: PermissionUpdateEntry[]; message?: string } = {},
) {
  const r = current.value;
  if (!r) return;
  const decision: PermissionDecision = {
    requestId: r.requestId,
    behavior,
    ...(opts.updatedInput !== undefined ? { updatedInput: opts.updatedInput } : {}),
    ...(opts.updatedPermissions !== undefined ? { updatedPermissions: opts.updatedPermissions } : {}),
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
}

watch(current, async (r) => {
  view.value = "collapsed";
  if (!r) {
    await hide();
    return;
  }
  await show();
});

watch(view, async () => {
  await nextTick();
  scheduleIpcResize();
});

watch(measuredHeight, () => {
  scheduleIpcResize();
});

onMounted(async () => {
  unlisten = await listen<PermissionRequest>("permission-request", async (e) => {
    queue.value.push(e.payload);
  });

  // ADR-0017 Q6: 5min timeout = 静默 deny，无 alarm 闪烁。
  unlistenTimeout = await listen<{ request_id: string }>(
    "permission-timeout",
    async (e) => {
      const reqId = e.payload.request_id;
      // 静默：直接发 deny decision + 移除当前 request。
      const r = queue.value.find((q) => q.requestId === reqId);
      if (!r) return;
      const decision: PermissionDecision = {
        requestId: reqId,
        behavior: "deny",
        message: "Request timed out",
      };
      try {
        await invoke("respond_permission", { decision });
      } catch (err) {
        console.error("[bubble] timeout respond_permission failed:", err);
      }
      queue.value = queue.value.filter((q) => q.requestId !== reqId);
    },
  );
});

onUnmounted(() => {
  unlisten?.();
  unlistenTimeout?.();
});
</script>

<template>
  <div class="w-full h-full bg-transparent pointer-events-none flex justify-center items-start overflow-hidden">
    <div
      :style="{ height: `${targetHeight}px` }"
      class="w-[280pt] bg-[var(--island)] backdrop-blur-[20px] backdrop-saturate-[180%] rounded-[14px] shadow-island pointer-events-auto overflow-hidden text-[var(--foreground)] flex flex-col transition-[height] duration-[280ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]"
      @mousedown="onBubbleMouseDown"
    >
      <div ref="contentInnerEl" class="flex flex-col">
        <BubblePill
          v-if="current"
          :request="current"
          :lang="lang"
          :expandable="true"
          :expanded="view === 'expanded'"
          :queue-depth="queue.length - 1"
          @body-click="onPillBodyClick"
          @action="onAction"
          @cancel="onCancel"
          @skip="onSkip"
        />

        <div
          v-if="expandedComponent && current && view === 'expanded'"
          class="flex flex-col pointer-events-auto overflow-hidden border-t border-[var(--divider-island)]"
        >
          <component
            :is="expandedComponent"
            ref="expandedRef"
            :request="(current as any)"
            @allow="onToolAllow"
            @deny="(msg: string) => submitDecision('deny', { message: msg })"
            @submit="onAskSubmit"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shadow-island {
  box-shadow: var(--shadow-island);
}
</style>
