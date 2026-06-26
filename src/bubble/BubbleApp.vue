<script setup lang="ts">
// src/bubble/BubbleApp.vue — 权限气泡顶层 dispatcher（ADR-0013）。
//
// **pill 态用 sonner toasts** — 多个 permission request 自动堆叠
// 显示（iOS 通知中心风）。BubbleApp 只协调事件 → toast()，
// **不**渲染 pill UI。
//
// expanded 态（SideEffect / Elicitation / PlanReview）走原
// expanded 流程 — 都在 480×360 固定 webview 内渲染，不 resize。
//
// 队列：单 `queue` ref 跟踪 pending request 顺序（用 toolRisk
// 决定是否 3s auto-allow）。Esc 全局 deny 当前 head。
//
// **click-through**：webview 永久固定 480×360 + body `pointer-events: none`，
// 跟 robot 窗口同款策略。可点的元素（pill-shell / expanded-shell）
// 自己加 `pointer-events: auto`。这彻底消除了 setSize/setPosition
// race — 窗口位置和大小都在创建时定一次。

import { ref, onMounted, onUnmounted, markRaw, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Toaster, toast } from "@/components/ui/sonner";
import type {
  PermissionDecision,
  PermissionRequest,
  SideEffectRequest,
  ElicitationRequest,
  PlanReviewRequest,
} from "../types/permission";
import { useBubbleLang } from "./lang";
import PillToast from "./PillToast.vue";
import SideEffectBubble from "./SideEffectBubble.vue";
import ElicitationBubble from "./ElicitationBubble.vue";
import PlanReviewBubble from "./PlanReviewBubble.vue";

type View = "idle" | "expanded";

const lang = useBubbleLang();

/**
 * 风险分级（ADR-0013 决策 T1 复活）：读/搜索类 = 低风险，3s
 * auto-allow；其他 = 高风险，必须手动。
 */
function toolRisk(toolName: string | undefined): "low" | "high" {
  if (!toolName) return "high";
  const lowRisk = new Set([
    "Read", "MultiRead", "Glob", "Grep", "WebFetch", "WebSearch", "LS",
  ]);
  return lowRisk.has(toolName) ? "low" : "high";
}

const LOW_RISK_AUTO_ALLOW_SECONDS = 3;

// 队列（pill 显示用 — 服务端 P2 仍持有真 pending）
const queue = ref<PermissionRequest[]>([]);
// 当前 expanded 显示的 request（pill 走 toast，不需要 currentRequest）
const expandedRequest = ref<PermissionRequest | null>(null);
const view = ref<View>("idle");
let unlisten: UnlistenFn | undefined;
let unlistenTimeout: UnlistenFn | undefined;
// 记录 toastId（key: requestId）— 用于 dismiss
const toastIds = new Map<string, string>();
// 记录 auto-allow timer（key: requestId）— 用户手动 allow/deny 时清理
const autoAllowTimers = new Map<string, ReturnType<typeof setTimeout>>();

const sideEffectRequest = computed<SideEffectRequest | null>(() => {
  const r = expandedRequest.value;
  return r && r.kind === "SideEffect" ? r : null;
});
const elicitationRequest = computed<ElicitationRequest | null>(() => {
  const r = expandedRequest.value;
  return r && r.kind === "Elicitation" ? r : null;
});
const planReviewRequest = computed<PlanReviewRequest | null>(() => {
  const r = expandedRequest.value;
  return r && r.kind === "PlanReview" ? r : null;
});

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

/** 清除 auto-allow timer（用户手动决策时调用） */
function clearAutoAllow(requestId: string) {
  const t = autoAllowTimers.get(requestId);
  if (t) {
    clearTimeout(t);
    autoAllowTimers.delete(requestId);
  }
}

/**
 * 决策路径：Allow/Deny 按钮 → 这里 invoke respond_permission +
 * 取消 auto-allow timer + dismiss toast。
 */
async function onDecide(requestId: string, behavior: "allow" | "deny") {
  clearAutoAllow(requestId);
  const decision: PermissionDecision = { requestId, behavior };
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
  }
  // dismiss 对应 toast
  const tid = toastIds.get(requestId);
  if (tid) {
    toast.dismiss(tid);
    toastIds.delete(requestId);
  }
  // 推进队列
  queue.value = queue.value.filter((r) => r.requestId !== requestId);
}

/** 展开 expanded view（SideEffect / Elicitation / PlanReview） */
function onExpand(request: PermissionRequest) {
  // 先 dismiss 药丸 toast（sonner 内部状态），否则 pill 仍
  // 可见 + Vue 模板渲染 expanded = 重叠
  const tid = toastIds.get(request.requestId);
  if (tid) {
    toast.dismiss(tid);
    toastIds.delete(request.requestId);
  }
  clearAutoAllow(request.requestId);
  expandedRequest.value = request;
  view.value = "expanded";
}

/** expanded 决策完（SideEffect / Elicitation / PlanReview 子组件 emit） */
async function onExpandedDecide(decision: PermissionDecision) {
  await onDecide(decision.requestId, decision.behavior);
  // expanded → 切回 idle（queue 可能还有，但 pill 由 sonner 管）
  expandedRequest.value = null;
  view.value = "idle";
  if (queue.value.length === 0) {
    await hide();
  }
}

/** 弹出 pill toast（每个 permission request 一个） */
function spawnPillToast(request: PermissionRequest) {
  const requestId = request.requestId;
  const isLowRisk =
    request.kind === "SideEffect" &&
    toolRisk((request as SideEffectRequest).toolName) === "low";

  // 低风险 3s auto-allow — setTimeout + toast.dismiss，
  // **不**用 sonner duration prop（避免与用户主动 dismiss 混淆）
  if (isLowRisk) {
    const timer = setTimeout(() => {
      onDecide(requestId, "allow");
    }, LOW_RISK_AUTO_ALLOW_SECONDS * 1000);
    autoAllowTimers.set(requestId, timer);
  }

  const toastId = toast.custom(
    markRaw(PillToast),
    {
      duration: Infinity,
      unstyled: true,
      componentProps: {
        request,
        lang: lang.value,
        onExpand: () => onExpand(request),
        onDecide: (behavior: "allow" | "deny") =>
          onDecide(requestId, behavior),
      },
      onDismiss: () => {
        toastIds.delete(requestId);
        clearAutoAllow(requestId);
        queue.value = queue.value.filter(
          (r) => r.requestId !== requestId,
        );
      },
    },
  );
  toastIds.set(requestId, String(toastId));
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  if (queue.value.length === 0) return;
  // Esc 拒绝 queue 头部（最旧）
  const head = queue.value[0];
  if (head) onDecide(head.requestId, "deny");
}

onMounted(async () => {
  document.addEventListener("keydown", onKeydown);

  unlisten = await listen<PermissionRequest>("permission-request", async (e) => {
    queue.value.push(e.payload);
    // 窗口永久 ready — 只 show 即可（no-op if already visible）
    await show();
    spawnPillToast(e.payload);
  });

  unlistenTimeout = await listen<{ request_id: string }>(
    "permission-timeout",
    (e) => {
      const tid = toastIds.get(e.payload.request_id);
      if (tid) toast.dismiss(tid);
    },
  );
});

onUnmounted(() => {
  unlisten?.();
  unlistenTimeout?.();
  document.removeEventListener("keydown", onKeydown);
  // 清理所有 auto-allow timers
  for (const t of autoAllowTimers.values()) clearTimeout(t);
  autoAllowTimers.clear();
});
</script>

<template>
  <div class="bubble-root h-full w-full">
    <template v-if="view === 'idle'"></template>

    <!--
      480×360 固定 webview。expanded 态两种 layout：
      - SideEffect：顶部居中，高度 auto（底部留空 click-through）
      - Elicitation / PlanReview：全填，内部 ScrollArea 滚动
    -->
    <div
      v-else-if="view === 'expanded' && sideEffectRequest"
      class="w-full h-full flex flex-col items-stretch justify-start p-0 pointer-events-none"
    >
      <SideEffectBubble
        :request="sideEffectRequest"
        @decide="onExpandedDecide"
      />
    </div>

    <div
      v-else-if="view === 'expanded' && elicitationRequest"
      class="expanded-frame expanded-frame--full w-full h-full flex flex-col items-stretch justify-stretch pointer-events-none"
    >
      <ElicitationBubble
        :request="elicitationRequest"
        @decide="onExpandedDecide"
      />
    </div>

    <div
      v-else-if="view === 'expanded' && planReviewRequest"
      class="expanded-frame expanded-frame--full w-full h-full flex flex-col items-stretch justify-stretch pointer-events-none"
    >
      <PlanReviewBubble
        :request="planReviewRequest"
        @decide="onExpandedDecide"
      />
    </div>

    <!-- Sonner toaster — pill 态由 sonner 管理堆叠 -->
    <Toaster />
  </div>
</template>

<style scoped>
.bubble-root {
  background: transparent;
}
</style>
