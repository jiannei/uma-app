<script setup lang="ts">
// src/bubble/PlanReviewBubble.vue — PlanReview (ExitPlanMode) 展开态。
//
// v5 + v6 轻改：
// - 删 "Claude Code plan review" header + "退出 Plan 模式" tag
// - 删底部 Approve/Reject 按钮（决策在 pill）
// - 去掉 pre 的 bg-muted（v6 — 背景统一）
// - 暴露 getFeedback 给父级

import { ref, computed, watch } from "vue";
import type { PlanReviewRequest } from "../types/permission";
import { bubbleText } from "./strings";
import { useBubbleLang } from "./lang";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

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

watch(
  () => props.request.requestId,
  () => { feedback.value = ""; },
);

function getFeedback(): string {
  return feedback.value.trim();
}

defineExpose({ getFeedback });
</script>

<template>
  <div class="expanded-shell flex flex-col gap-2 p-3 text-[13px] select-none w-full">
    <!-- v6 轻改：pre 去 bg-muted，背景统一 -->
    <pre class="text-foreground font-mono text-[11px] p-2.5 rounded-md overflow-auto whitespace-pre-wrap break-words m-0 border border-border/40">{{ planText }}</pre>

    <div class="flex flex-col gap-1 flex-shrink-0">
      <Label
        for="plan-feedback"
        class="text-[10px] text-muted-foreground uppercase tracking-wider"
      >
        {{ bubbleText(lang, "feedbackLabel") }}
      </Label>
      <Textarea
        id="plan-feedback"
        :model-value="feedback"
        @update:model-value="(v: any) => (feedback = String(v))"
        class="text-[12px] min-h-[60px]"
        rows="3"
        :placeholder="bubbleText(lang, 'feedbackPlaceholder')"
      />
    </div>
  </div>
</template>
