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
import type {
  PlanReviewRequest,
  PermissionDecision,
} from "../types/permission";
import { bubbleText } from "./strings";
import { useBubbleLang } from "./lang";

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
  <div class="kind planreview">
    <header>
      <span class="icon">📋</span>
      <span class="title">{{ props.request.agentDisplayName }} plan review</span>
      <span class="tool-pill">{{ bubbleText(lang, "toolPill") }}</span>
    </header>

    <pre class="plan">{{ planText }}</pre>

    <div class="feedback">
      <label class="feedback-label" for="plan-feedback">
        {{ bubbleText(lang, "feedbackLabel") }}
      </label>
      <textarea
        id="plan-feedback"
        v-model="feedback"
        class="feedback-textarea"
        rows="3"
        :placeholder="bubbleText(lang, 'feedbackPlaceholder')"
        :disabled="sending"
      />
    </div>

    <div class="actions">
      <button
        class="btn primary"
        :disabled="sending"
        @click="approve"
      >
        {{ bubbleText(lang, "approve") }}
      </button>
      <button
        class="btn deny"
        :disabled="sending"
        @click="reject"
      >
        {{ feedback.trim()
          ? bubbleText(lang, "rejectWithFeedback")
          : bubbleText(lang, "reject") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.kind {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  font-size: 13px;
  user-select: none;
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  background: #cba6f7;
  border-radius: 50%;
  color: #1e1e2e;
}

.title {
  font-weight: 600;
  flex: 1;
  color: #cdd6f4;
}

.tool-pill {
  font-family: monospace;
  font-size: 11px;
  background: #313244;
  color: #cba6f7;
  padding: 2px 8px;
  border-radius: 4px;
}

.plan {
  background: #1e1e2e;
  color: #cdd6f4;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  padding: 10px 12px;
  border-radius: 6px;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  border: 1px solid #313244;
}

.feedback {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feedback-label {
  font-size: 10px;
  color: #a6adc8;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.feedback-textarea {
  width: 100%;
  min-height: 60px;
  background: #1e1e2e;
  color: #cdd6f4;
  border: 1px solid #45475a;
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

.feedback-textarea:focus {
  outline: none;
  border-color: #89b4fa;
}

.actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
}

.btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn:active:not(:disabled) {
  transform: scale(0.98);
}

.btn.primary { background: #a6e3a1; color: #1e1e2e; }
.btn.deny { background: #f38ba8; color: #1e1e2e; }
</style>
