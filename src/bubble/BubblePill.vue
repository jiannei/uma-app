<script setup lang="ts">
// src/bubble/BubblePill.vue — bubble 顶部 pill（ADR-0017 收敛版）。
//
// 永远在顶部，承载所有 kind 的主要操作。
// 按 kind 切换主按钮图标/文字：
//   - SideEffect  → ✓ Check + "Allow"
//   - PlanReview  → ✓ Check + "Approve"
//   - Elicitation → → ArrowRight + "Next" / "Submit" (BubbleApp 切换)
//
// ↗ chevron 仅在队列>1 且 kind !== Elicitation 时显示
// （ask 内部一次 request = N 题，没有"跳到下一 request"概念）。
//
// emit:
//   "body-click" → BubbleApp 切换 collapsed/expanded
//   "action"     → BubbleApp 顶层 dispatch（kind-aware 决策）
//   "cancel"     → BubbleApp 顶层 dispatch（kind-aware 决策）
//   "skip"       → BubbleApp deny current + advance（FIFO）

import { computed } from "vue";
import type { PermissionRequest } from "../types/permission";
import { bubbleText } from "./strings";
import { formatDetail } from "./format-detail";
import { classifySideEffect } from "./format-side-effect";

const props = defineProps<{
  request: PermissionRequest;
  lang: "en" | "zh";
  expandable: boolean;
  expanded: boolean;
  /** Pending requests behind current. Chevron shows when queueDepth > 1
   *  AND kind !== Elicitation (ADR-0017 Q4). */
  queueDepth: number;
}>();

const emit = defineEmits<{
  "body-click": [];
  action: [];
  cancel: [];
  skip: [];
}>();

// Tool-aware icon: SideEffect varies by tool, Elicitation/PlanReview fixed.
const toolIcon = computed<string>(() => {
  const r = props.request;
  if (r.kind === "SideEffect") {
    const render = classifySideEffect(r.toolName, r.toolInput);
    switch (render.kind) {
      case "bash": return "i-lucide-terminal";
      case "edit": return "i-lucide-pencil";
      case "write": return "i-lucide-file-pen";
      case "read": return "i-lucide-eye";
      case "json": return "i-lucide-info";
    }
  }
  if (r.kind === "Elicitation") return "i-lucide-help-circle";
  return "i-lucide-clipboard-list";
});

const kindVariantClass = computed<string>(() => {
  switch (props.request.kind) {
    case "SideEffect": return "text-[var(--deny)]";
    case "Elicitation": return "text-[var(--allow)]";
    case "PlanReview": return "text-[var(--muted-foreground)]";
  }
});

const detail = computed<string>(() => {
  if (props.request.kind === "SideEffect") {
    return formatDetail(props.request.toolName, props.request.toolInput, 50);
  }
  if (props.request.kind === "Elicitation") {
    return bubbleText(props.lang, "questionCount", {
      current: 1,
      total: props.request.questions.length,
    });
  }
  const p = props.request;
  const plan = p.planContent ?? (p.toolInput as { plan?: string } | null)?.plan;
  if (typeof plan !== "string") return "";
  return plan.length > 50 ? plan.slice(0, 49) + "…" : plan;
});

const primaryIcon = computed<string>(() => {
  if (props.request.kind === "Elicitation") return "i-lucide-arrow-right";
  return "i-lucide-check";
});

const primaryLabel = computed<string>(() => {
  switch (props.request.kind) {
    case "SideEffect": return bubbleText(props.lang, "allow");
    case "PlanReview": return bubbleText(props.lang, "approve");
    case "Elicitation": return bubbleText(props.lang, "next");
  }
});

const cancelLabel = computed<string>(() => {
  if (props.request.kind === "PlanReview") return bubbleText(props.lang, "reject");
  return bubbleText(props.lang, "deny");
});

// ADR-0017 Q4: Elicitation hides chevron — ask is one request with N questions,
// no "next permission request" concept inside it.
const showSkip = computed<boolean>(
  () => props.queueDepth > 1 && props.request.kind !== "Elicitation",
);

function onBody() { if (props.expandable) emit("body-click"); }
function onAction() { emit("action"); }
function onCancel() { emit("cancel"); }
function onSkip() { emit("skip"); }
</script>

<template>
  <div
    class="flex-none h-12 flex items-center gap-2 px-3 min-w-[280px] bg-transparent select-none pointer-events-auto"
    role="group"
    :aria-label="bubbleText(lang, 'permissionRequest')"
  >
    <button
      type="button"
      :class="[
        'flex items-center gap-2 flex-1 min-w-0 bg-transparent border-0 p-0 text-left cursor-default text-inherit',
        expandable && 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--island)] rounded-md',
      ]"
      :aria-expanded="expandable ? expanded : undefined"
      :tabindex="expandable ? 0 : -1"
      @click="onBody"
    >
      <span :class="['inline-flex items-center justify-center w-[22px] h-[22px] rounded-full bg-transparent border border-solid border-current flex-none', kindVariantClass]">
        <div :class="[toolIcon, 'h-3.5 w-3.5']" />
      </span>
      <span class="flex flex-row items-center min-w-0 flex-1">
        <span v-if="detail" class="text-[12px] font-medium font-mono whitespace-nowrap overflow-hidden text-ellipsis text-[var(--foreground)]">{{ detail }}</span>
      </span>
    </button>

    <span class="w-px self-stretch bg-[var(--divider-island)] my-2" aria-hidden="true" />

    <div class="flex items-center gap-1 flex-none">
      <button
        type="button"
        class="inline-flex items-center justify-center w-7 h-7 rounded-full border-0 bg-transparent cursor-pointer transition-colors duration-[120ms] hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)] text-[var(--allow)]"
        :aria-label="primaryLabel"
        @click.stop="onAction"
      >
        <div :class="[primaryIcon, 'h-4 w-4 stroke-[2.5]']" />
      </button>
      <button
        type="button"
        class="inline-flex items-center justify-center w-7 h-7 rounded-full border-0 bg-transparent cursor-pointer transition-colors duration-[120ms] hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)] text-[var(--deny)]"
        :aria-label="cancelLabel"
        @click.stop="onCancel"
      >
        <div class="i-lucide-x h-3.5 w-3.5 stroke-[3]" />
      </button>
      <button
        v-if="showSkip"
        type="button"
        class="inline-flex items-center gap-0.5 px-1.5 py-1 ml-0.5 border-0 bg-transparent text-[var(--muted-foreground)] text-[12px] font-medium cursor-pointer rounded-md transition-[color,background,transform] duration-[150ms] hover:text-[var(--foreground)] hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)]"
        :aria-label="`Skip current and advance (${queueDepth} more)`"
        @click.stop="onSkip"
      >
        <span class="text-[14px] leading-none font-normal">›</span>
        <span class="tabular-nums text-[11px]">{{ queueDepth }}</span>
      </button>
    </div>
  </div>
</template>
