<script setup lang="ts">
// src/bubble/PlanBubble.vue — PlanReview (ExitPlanMode) 展开态（ADR-0017 Q5）。
//
// 顶部 plan 文本（scrollable），底部 feedback textarea 永久显示。
// plan ≥ 一屏时必须滚到底才能 Approve（scrollToBottom gating）。
//
// emit:
//   "allow"          →  Approve（reply: behavior: "allow"）
//   "deny" + message →  Reject（reply: behavior: "deny", message: feedback）
//
// expose:
//   canApprove   → BubbleApp.onAction 检查 plan 是否滚到底
//   getFeedback  → BubbleApp.onAction/onCancel 取 feedback 作为 message
//   scrollToBottom → BubbleApp 在 !canApprove 时强制滚到底

import { ref, computed, watch } from "vue";
import type { PlanReviewRequest } from "../types/permission";
import { bubbleText } from "./strings";
import { useBubbleLang } from "./lang";

const lang = useBubbleLang();

const props = defineProps<{
  request: PlanReviewRequest;
}>();

const planText = computed<string>(() => {
  if (props.request.planContent) return props.request.planContent;
  const plan = (props.request.toolInput as { plan?: string } | null)?.plan;
  return typeof plan === "string" ? plan : bubbleText(lang.value, "noPlanContent");
});

const feedback = ref("");
const planScrollEl = ref<HTMLElement | null>(null);
const scrollProgress = ref(0);

function updateScrollProgress() {
  const el = planScrollEl.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  scrollProgress.value = max > 0 ? el.scrollTop / max : 1;
}

function scrollToBottom() {
  const el = planScrollEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

const canApprove = computed<boolean>(() => {
  const el = planScrollEl.value;
  if (!el) return true;
  if (el.scrollHeight <= el.clientHeight + 4) return true;
  return scrollProgress.value >= 0.99;
});

watch(
  () => props.request.requestId,
  () => {
    feedback.value = "";
    scrollProgress.value = 0;
  },
);

function getFeedback(): string {
  return feedback.value.trim();
}

defineExpose({ canApprove, getFeedback, scrollToBottom });
</script>

<template>
  <div class="flex flex-col gap-2 p-3 text-[13px] select-none w-full">
    <!-- Plan text (scrollable) -->
    <div
      ref="planScrollEl"
      class="flex-1 min-h-0 max-h-[380px] overflow-y-auto border border-[var(--divider-island)] rounded-md p-2.5 m-0"
      @scroll="updateScrollProgress"
    >
      <pre class="font-mono text-[11px] text-[var(--foreground)] whitespace-pre-wrap break-words m-0">{{ planText }}</pre>
    </div>

    <!-- Progress bar (only when plan is multi-screen) -->
    <div
      class="h-[2px] rounded-[1px] overflow-hidden flex-shrink-0 bg-[var(--muted-foreground)]/30"
      aria-hidden="true"
    >
      <div
        :class="['h-full rounded-[1px] transition-[width] duration-100', canApprove ? 'bg-[var(--allow)]' : 'bg-[var(--foreground)]']"
        :style="{ width: `${scrollProgress * 100}%` }"
      />
    </div>

    <!-- Permanent feedback textarea (bottom) -->
    <div class="flex flex-col gap-1 flex-shrink-0">
      <label
        for="plan-feedback"
        class="text-[10px] text-[var(--muted-foreground)] uppercase tracking-wider"
      >
        {{ bubbleText(lang, "feedbackLabel") }}
      </label>
      <textarea
        id="plan-feedback"
        v-model="feedback"
        class="text-[12px] min-h-[60px] w-full bg-transparent border border-[var(--border)]/40 rounded p-1.5 font-sans resize-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)]"
        rows="3"
        :placeholder="bubbleText(lang, 'feedbackPlaceholder')"
      />
    </div>
  </div>
</template>
