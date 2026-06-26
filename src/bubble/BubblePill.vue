<script setup lang="ts">
// src/bubble/BubblePill.vue — bubble 顶部 pill。
//
// 永远在顶部，不被 dismiss。**v5 按 kind 渲染不同主操作**：
// - SideEffect / PlanReview：✓（Check）+ ✗（X）—— 经典 allow/deny
// - Elicitation：→（ArrowRight）+ ✗（X）—— next 触发 goNextOrSubmit

import { computed } from "vue";
import {
  Shield,
  HelpCircle,
  ClipboardList,
  ArrowRight,
  Check,
  X,
  type LucideIcon,
} from "@lucide/vue";
import type {
  ElicitationRequest,
  PermissionRequest,
  PlanReviewRequest,
  SideEffectRequest,
} from "../types/permission";
import { bubbleText, type Lang } from "./strings";
import { formatDetail } from "./format-detail";

const props = defineProps<{
  request: PermissionRequest;
  lang: Lang;
  expandable: boolean;
  expanded: boolean;
}>();

const emit = defineEmits<{
  "body-click": [];
  action: [];
  cancel: [];
}>();

const kindIcon = computed<LucideIcon>(() => {
  switch (props.request.kind) {
    case "SideEffect": return Shield;
    case "Elicitation": return HelpCircle;
    case "PlanReview": return ClipboardList;
  }
});

const sideEffectSummary = computed<string>(() => {
  if (props.request.kind !== "SideEffect") return "";
  const s = props.request as SideEffectRequest;
  return formatDetail(s.toolName, s.toolInput, 50);
});

const kindLabel = computed<string>(() => {
  const r = props.request;
  switch (r.kind) {
    case "SideEffect": {
      const s = r as SideEffectRequest;
      return s.toolName ?? bubbleText(props.lang, "permissionRequest");
    }
    case "Elicitation": {
      const e = r as ElicitationRequest;
      // v6: 显示当前题 header（不是第一个）；ElicitationBubble 通过冒泡事件更新
      // 这里暂时用第一题 header，ElicitationBubble 可以通过 emit 通知更新
      return e.questions[0]?.header ?? bubbleText(props.lang, "elicitation");
    }
    case "PlanReview":
      return bubbleText(props.lang, "planReview");
  }
});

const detail = computed<string>(() => {
  if (props.request.kind === "SideEffect") return sideEffectSummary.value;
  if (props.request.kind === "Elicitation") {
    const e = props.request as ElicitationRequest;
    return bubbleText(props.lang, "questionCount", {
      current: 1,
      total: e.questions.length,
    });
  }
  const p = props.request as PlanReviewRequest;
  const plan = p.planContent ?? (p.toolInput as { plan?: string } | null)?.plan;
  if (typeof plan !== "string") return "";
  return plan.length > 50 ? plan.slice(0, 49) + "…" : plan;
});

const primaryIcon = computed<LucideIcon>(() => {
  if (props.request.kind === "Elicitation") return ArrowRight;
  return Check;
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

function onBody() { if (props.expandable) emit("body-click"); }
function onAction() { emit("action"); }
function onCancel() { emit("cancel"); }
</script>

<template>
  <div
    class="pill-shell pointer-events-auto"
    :class="{ 'pill-shell--expandable': expandable && !expanded }"
    role="group"
    :aria-label="bubbleText(lang, 'permissionRequest')"
  >
    <button
      type="button"
      class="pill-body"
      :class="{ 'pill-body--clickable': expandable }"
      :aria-expanded="expandable ? expanded : undefined"
      :tabindex="expandable ? 0 : -1"
      @click="onBody"
    >
      <span class="pill-icon">
        <component :is="kindIcon" class="h-3.5 w-3.5" />
      </span>
      <span class="pill-text">
        <span class="pill-label">{{ kindLabel }}</span>
        <span v-if="detail" class="pill-summary">{{ detail }}</span>
      </span>
    </button>

    <span class="pill-divider" aria-hidden="true" />

    <div class="pill-actions">
      <button
        type="button"
        class="pill-icon-btn pill-action"
        :aria-label="primaryLabel"
        @click.stop="onAction"
      >
        <component :is="primaryIcon" class="h-4 w-4 stroke-[2.5]" />
      </button>
      <button
        type="button"
        class="pill-icon-btn pill-cancel"
        :aria-label="cancelLabel"
        @click.stop="onCancel"
      >
        <X class="h-3.5 w-3.5 stroke-[3]" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.pill-shell {
  flex: 0 0 80px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 80px;
  min-width: 280px;
  background: transparent;
  user-select: none;
  pointer-events: auto;
}
.pill-shell--expandable {
  animation: pill-pulse 2.4s ease-in-out infinite;
}
@keyframes pill-pulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}
@media (prefers-reduced-motion: reduce) {
  .pill-shell--expandable { animation: none; }
}
.pill-body {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: default;
  color: inherit;
}
.pill-body--clickable { cursor: pointer; }
.pill-body--clickable:focus-visible {
  outline: 2px solid var(--bubble-focus, rgba(255, 255, 255, 0.4));
  outline-offset: 2px;
  border-radius: 6px;
}
.pill-icon {
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  background: var(--bubble-btn-hover, rgba(255, 255, 255, 0.08));
  flex: 0 0 auto;
}
.pill-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
}
.pill-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--bubble-text, #f5f5f7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill-summary {
  font-size: 10px;
  color: var(--bubble-text-muted, rgba(235, 235, 245, 0.6));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill-divider {
  width: 1px;
  align-self: stretch;
  background: var(--bubble-divider, rgba(255, 255, 255, 0.08));
  margin: 8px 0;
}
.pill-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.pill-icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 120ms;
}
.pill-icon-btn:hover { background: var(--bubble-btn-hover, rgba(255, 255, 255, 0.08)); }
.pill-icon-btn:focus-visible { outline: 2px solid var(--bubble-focus, rgba(255, 255, 255, 0.4)); outline-offset: 1px; }
.pill-action { color: var(--bubble-allow, #4ade80); }
.pill-action:hover { background: var(--bubble-allow-hover, rgba(74, 222, 128, 0.18)); }
.pill-cancel  { color: var(--bubble-deny,  #f87171); }
.pill-cancel:hover  { background: var(--bubble-deny-hover,  rgba(248, 113, 113, 0.18)); }
</style>
