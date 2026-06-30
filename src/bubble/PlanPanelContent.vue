<script setup lang="ts">
// src/bubble/PlanPanelContent.vue — PlanReview panel content.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: PlanReviewRequest
//
// Emits:
//   - "approve": user approved
//   - "reject": user rejected (with feedback message?)

import { ref, computed, watch } from "vue";
import type { PlanReviewRequest } from "../types/permission";

const props = defineProps<{
  request: PlanReviewRequest;
}>();

const emit = defineEmits<{
  (e: "approve"): void;
  (e: "reject", message?: string): void;
}>();

const feedback = ref("");
const planScrollEl = ref<HTMLElement | null>(null);
const scrollProgress = ref(0);

const planText = computed<string>(() => {
  if (props.request.planContent) return props.request.planContent;
  const plan = (props.request.toolInput as { plan?: string } | null)?.plan;
  return typeof plan === "string" ? plan : "No plan content available";
});

function updateScrollProgress() {
  const el = planScrollEl.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  scrollProgress.value = max > 0 ? el.scrollTop / max : 1;
}

const canApprove = computed<boolean>(() => {
  const el = planScrollEl.value;
  if (!el) return true;
  if (el.scrollHeight <= el.clientHeight + 4) return true;
  return scrollProgress.value >= 0.99;
});

function scrollToBottom() {
  const el = planScrollEl.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
}

function approve() {
  if (!canApprove.value) {
    scrollToBottom();
    return;
  }
  emit("approve");
}

function reject() {
  emit("reject", feedback.value.trim() || undefined);
}

watch(
  () => props.request.requestId,
  () => {
    feedback.value = "";
    scrollProgress.value = 0;
  },
);
</script>

<template>
  <div class="plan-panel-content">
    <div class="progress-section">
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: `${scrollProgress * 100}%` }"
        ></div>
      </div>
      <div class="read-percent" v-if="!canApprove">
        已读 {{ Math.round(scrollProgress * 100) }}%
      </div>
      <div class="read-percent complete" v-else>✓ 完整可见</div>
    </div>

    <div
      class="plan-text"
      ref="planScrollEl"
      @scroll="updateScrollProgress"
    >
      <pre>{{ planText }}</pre>
    </div>

    <div class="feedback-section">
      <div class="feedback-label">拒绝原因(可选)</div>
      <textarea
        class="feedback-textarea"
        v-model="feedback"
        placeholder="e.g. step 4 拆得太粗..."
      ></textarea>
    </div>

    <div class="footer-buttons">
      <span class="footer-hint">
        <template v-if="!canApprove">↓ scroll to end to Approve</template>
        <template v-else>✓ 可直接 Approve</template>
      </span>
      <span style="flex: 1;"></span>
      <button class="footer-button reject" @click="reject">
        Reject
      </button>
      <button
        class="footer-button approve"
        @click="approve"
        :disabled="!canApprove"
      >
        Approve
      </button>
    </div>
  </div>
</template>

<style scoped>
.plan-panel-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.progress-bar {
  flex: 1;
  height: 2px;
  background: rgba(255, 255, 255, 0.06);
}

.progress-fill {
  height: 100%;
  background: #22c55e;
  transition: width 200ms;
}

.read-percent {
  font-size: 11px;
  color: #a1a1aa;
}

.read-percent.complete {
  color: #22c55e;
}

.plan-text {
  background: rgba(0, 0, 0, 0.30);
  padding: 8px 10px;
  border-radius: 6px;
  font: 11.5px/1.5 ui-monospace, SFMono-Regular, monospace;
  color: #e4e4e7;
  white-space: pre-wrap;
  max-height: 240pt;
  overflow-y: auto;
}

.feedback-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.feedback-label {
  font-size: 11px;
  color: #a1a1aa;
}

.feedback-textarea {
  width: 100%;
  min-height: 48px;
  resize: vertical;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #f4f4f5;
  font: 12px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
  outline: none;
}

.footer-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}

.footer-hint {
  font-size: 11px;
  color: #a1a1aa;
}

.footer-button {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  cursor: pointer;
}

.footer-button.reject {
  background: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
}

.footer-button.approve {
  background: rgba(255, 255, 255, 0.10);
  color: rgba(255, 255, 255, 0.5);
  font-weight: 600;
}

.footer-button.approve:disabled {
  cursor: not-allowed;
}

.footer-button.approve:not(:disabled) {
  background: #22c55e;
  color: #052e10;
}
</style>
