<script setup lang="ts">
// src/bubble/PlanReviewBubble.vue — PlanReview (ExitPlanMode)
// renderer.
//
// Displays the plan content (either normalized `planContent` or
// the raw `toolInput.plan` field) and offers two paths:
//   - Approve  → behavior: "allow" (CC proceeds with the plan)
//   - Reject   → behavior: "deny" with an optional `message`
//     (CC reads the message and revises the plan accordingly)
//
// The feedback textarea is always visible — users can type
// feedback before clicking Reject, or just hit Reject without
// any text. (CC accepts a `deny` with no `message`; the agent's
// plan is rejected without a revision hint.)

import { ref, computed, watch } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardList } from "@lucide/vue";
import type {
  PlanReviewRequest,
  PermissionDecision,
} from "../types/permission";
import { bubbleText } from "./strings";
import { useBubbleLang } from "./lang";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import BubbleHeader from "@/components/bubble/BubbleHeader.vue";

const lang = useBubbleLang(); // reactive — updated by set_language

const props = defineProps<{
  request: PlanReviewRequest;
}>();

// Prefer the normalized plan_content; fall back to toolInput.plan
// (CC's older shape).
const planText = computed<string>(() => {
  if (props.request.planContent) return props.request.planContent;
  const plan = (props.request.toolInput as { plan?: string } | null)?.plan;
  return typeof plan === "string"
    ? plan
    : bubbleText(lang.value, "noPlanContent");
});

const feedback = ref("");
const sending = ref(false);

// Reset feedback when the request changes (e.g. new ExitPlanMode).
watch(
  () => props.request.requestId,
  () => {
    feedback.value = "";
    sending.value = false;
  },
);

async function approve() {
  if (sending.value) return;
  sending.value = true;
  const decision: PermissionDecision = {
    requestId: props.request.requestId,
    behavior: "allow",
  };
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
    sending.value = false;
  }
}

async function reject() {
  if (sending.value) return;
  sending.value = true;
  const trimmed = feedback.value.trim();
  const decision: PermissionDecision = {
    requestId: props.request.requestId,
    behavior: "deny",
    ...(trimmed ? { message: trimmed } : {}),
  };
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
    sending.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-2.5 p-3 text-[13px] select-none">
    <BubbleHeader
      :icon="ClipboardList"
      variant="secondary"
      :title="`${props.request.agentDisplayName} plan review`"
      :tag="bubbleText(lang, 'toolPill')"
    />

    <pre class="bg-muted text-foreground font-mono text-[11px] p-2.5 rounded-md max-h-[180px] overflow-auto whitespace-pre-wrap break-words m-0 border border-border">{{ planText }}</pre>

    <div class="flex flex-col gap-1">
      <Label for="plan-feedback" class="text-[10px] text-muted-foreground uppercase tracking-wider">
        {{ bubbleText(lang, "feedbackLabel") }}
      </Label>
      <Textarea
        id="plan-feedback"
        :model-value="feedback"
        @update:model-value="(v: any) => (feedback = String(v))"
        class="text-[12px] min-h-[60px]"
        rows="3"
        :placeholder="bubbleText(lang, 'feedbackPlaceholder')"
        :disabled="sending"
      />
    </div>

    <div class="flex gap-1.5 mt-auto">
      <Button
        variant="default"
        class="flex-1"
        :disabled="sending"
        @click="approve"
      >
        {{ bubbleText(lang, "approve") }}
      </Button>
      <Button
        variant="destructive"
        class="flex-1"
        :disabled="sending"
        @click="reject"
      >
        {{ feedback.trim()
          ? bubbleText(lang, "rejectWithFeedback")
          : bubbleText(lang, "reject") }}
      </Button>
    </div>
  </div>
</template>
