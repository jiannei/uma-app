<script setup lang="ts">
// src/bubble/PillToast.vue — Sonner toast 内容（无状态）。
//
// 由 BubbleApp 通过 `toast(markRaw(PillToast), { ... })` 渲染。
// 完全无状态 — 倒计时 / queue / 动画全部由 BubbleApp 协调
// （或 sonner 自己处理）。
//
// 视觉跟原 PillBubble 一致：
//   - 左侧工具图标（按 tool_name 选 Lucide 图标）
//   - 中间摘要（SideEffect 显示 tool_input 一行；其他 kind 显示 label）
//   - 右侧 Allow/Deny 圆形 icon button

import { computed } from "vue";
import {
  Shield,
  HelpCircle,
  ClipboardList,
  Check,
  X,
  ArrowRight,
  ClipboardCheck,
  Terminal,
  Pencil,
  FilePen,
  Eye,
  Search,
  ListTodo,
  Globe,
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
  /** Sonner 渲染上下文没法走 emit — 直接传 handler 进来。 */
  onExpand?: () => void;
  onDecide?: (behavior: "allow" | "deny") => void;
}>();

// Per-kind fallback 图标
const kindIcon = computed<LucideIcon>(() => {
  switch (props.request.kind) {
    case "SideEffect":
      return Shield;
    case "Elicitation":
      return HelpCircle;
    case "PlanReview":
      return ClipboardList;
  }
});

// Tool-specific 图标（SideEffect 优先）
const toolIcon = computed<LucideIcon | null>(() => {
  if (props.request.kind !== "SideEffect") return null;
  const name = (props.request as SideEffectRequest).toolName;
  if (!name) return null;
  switch (name) {
    case "Bash":
      return Terminal;
    case "Edit":
      return Pencil;
    case "Write":
      return FilePen;
    case "Read":
    case "MultiRead":
      return Eye;
    case "Glob":
    case "Grep":
    case "WebSearch":
      return Search;
    case "Task":
      return ListTodo;
    case "WebFetch":
      return Globe;
    default:
      return null;
  }
});

const displayIcon = computed<LucideIcon>(
  () => toolIcon.value ?? kindIcon.value,
);

const kindLabel = computed<string>(() => {
  switch (props.request.kind) {
    case "SideEffect":
      return props.request.toolName ?? bubbleText(props.lang, "permissionRequest");
    case "Elicitation": {
      const r = props.request as ElicitationRequest;
      return bubbleText(props.lang, "questionProgress", {
        current: 1,
        total: r.questions.length,
      });
    }
    case "PlanReview":
      return bubbleText(props.lang, "planReview");
  }
});

const sideEffectSummary = computed<string>(() => {
  if (props.request.kind !== "SideEffect") return "";
  const s = props.request as SideEffectRequest;
  return formatDetail(s.toolName, s.toolInput, 60);
});

const elicitationHeader = computed<string>(() => {
  if (props.request.kind !== "Elicitation") return "";
  const r = props.request as ElicitationRequest;
  return r.questions[0]?.header ?? "";
});

const planShort = computed<string>(() => {
  if (props.request.kind !== "PlanReview") return "";
  const r = props.request as PlanReviewRequest;
  const plan = r.planContent ?? (r.toolInput as { plan?: string } | null)?.plan;
  if (typeof plan !== "string") return "";
  return plan.length > 60 ? plan.slice(0, 59) + "…" : plan;
});

function onExpand() {
  props.onExpand?.();
}
function onAllow() {
  props.onDecide?.("allow");
}
function onDeny() {
  props.onDecide?.("deny");
}
</script>

<template>
  <div
    class="pill-shell flex items-center gap-2 px-3 h-11 select-none min-w-[260px] pointer-events-auto"
  >
    <!-- 左侧 ⓘ 详情区：点击展开 expanded view -->
    <button
      type="button"
      class="pill-detail flex items-center gap-2 flex-1 min-w-0 text-left rounded-md"
      :aria-label="bubbleText(lang, 'permissionRequest')"
      @click="onExpand"
    >
      <span class="pill-icon w-[22px] h-[22px] flex items-center justify-center rounded-full bg-secondary text-secondary-foreground">
        <component :is="displayIcon" class="h-3.5 w-3.5" />
      </span>
      <span class="pill-text flex flex-col min-w-0 flex-1">
        <span
          v-if="request.kind === 'Elicitation' || request.kind === 'PlanReview'"
          class="pill-label text-[12px] font-semibold text-foreground truncate"
        >
          {{ kindLabel }}
        </span>
        <span
          v-if="request.kind === 'SideEffect' && sideEffectSummary"
          class="pill-summary text-[10px] text-muted-foreground truncate font-mono"
        >
          {{ sideEffectSummary }}
        </span>
        <span
          v-else-if="request.kind === 'Elicitation' && elicitationHeader"
          class="pill-summary text-[10px] text-muted-foreground truncate"
        >
          {{ elicitationHeader }}
        </span>
        <span
          v-else-if="request.kind === 'PlanReview' && planShort"
          class="pill-summary text-[10px] text-muted-foreground truncate"
        >
          {{ planShort }}
        </span>
      </span>
    </button>

    <!-- 右侧决策区 -->
    <template v-if="request.kind === 'SideEffect'">
      <span class="pill-divider" aria-hidden="true" />
      <button
        type="button"
        class="pill-icon-btn pill-allow"
        :aria-label="bubbleText(lang, 'allow')"
        @click.stop="onAllow"
      >
        <Check class="h-3.5 w-5 stroke-[3]" />
      </button>
      <button
        type="button"
        class="pill-icon-btn pill-deny"
        :aria-label="bubbleText(lang, 'deny')"
        @click.stop="onDeny"
      >
        <X class="h-3.5 w-5 stroke-[3]" />
      </button>
    </template>

    <template v-else-if="request.kind === 'Elicitation'">
      <span class="pill-divider" aria-hidden="true" />
      <button
        type="button"
        class="pill-icon-btn pill-allow"
        :aria-label="bubbleText(lang, 'nextQuestion')"
        @click.stop="onExpand"
      >
        <ArrowRight class="h-3.5 w-5 stroke-[3]" />
      </button>
    </template>

    <template v-else-if="request.kind === 'PlanReview'">
      <span class="pill-divider" aria-hidden="true" />
      <button
        type="button"
        class="pill-icon-btn pill-allow"
        :aria-label="bubbleText(lang, 'planReview')"
        @click.stop="onExpand"
      >
        <ClipboardCheck class="h-3.5 w-5 stroke-[2.5]" />
      </button>
    </template>
  </div>
</template>

<style scoped>
/* 药丸外壳：黑底 + 圆角 + 毛玻璃（沿用 PillBubble 的样式）。
   Sonner 自身的 toast 卡片已经提供 padding / 边框 / 阴影，
   我们的 pill-shell 是**内容容器**（贴在 toast 内部）。 */
.pill-shell {
  background: rgba(24, 24, 28, 0.72);
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}
@supports not (backdrop-filter: blur(20px)) {
  .pill-shell {
    background: rgba(24, 24, 28, 0.95);
  }
}

.pill-detail {
  background: transparent;
  border: 0;
  padding: 0;
  cursor: pointer;
  color: inherit;
  border-radius: 8px;
}
.pill-detail:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
}

.pill-icon-btn {
  background: transparent;
  border: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.15s;
  flex-shrink: 0;
}
.pill-allow {
  color: rgb(74, 222, 128);
}
.pill-allow:hover {
  background: rgba(74, 222, 128, 0.18);
}
.pill-allow:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(74, 222, 128, 0.6);
}
.pill-deny {
  color: rgb(248, 113, 113);
}
.pill-deny:hover {
  background: rgba(248, 113, 113, 0.18);
}
.pill-deny:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.6);
}

.pill-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.08);
  margin: 0 2px;
}
</style>
