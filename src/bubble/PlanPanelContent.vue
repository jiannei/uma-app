<script setup lang="ts">
// src/bubble/PlanPanelContent.vue — PlanReview panel content.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: PlanReviewRequest
//
// Emits:
//   - "approve": user approved
//   - "reject": user rejected (with feedback message — required)

import { ref, computed, watch } from "vue";
import type { PlanReviewRequest } from "../types/permission";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  request: PlanReviewRequest;
}>();

const emit = defineEmits<{
  (e: "approve"): void;
  (e: "reject", message: string): void;
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

const canReject = computed<boolean>(() => feedback.value.trim().length > 0);

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
  if (!canReject.value) return;
  emit("reject", feedback.value.trim());
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
        {{ Math.round(scrollProgress * 100) }}%
      </div>
      <div class="read-percent complete" v-else>✓ {{ t('bubble.gotIt') }}</div>
    </div>

    <div
      class="plan-text"
      ref="planScrollEl"
      @scroll="updateScrollProgress"
    >
      <pre>{{ planText }}</pre>
    </div>

    <div class="feedback-section">
      <div class="feedback-label">{{ t('bubble.tellClaudeToChange') }}</div>
      <textarea
        class="feedback-textarea"
        v-model="feedback"
        :placeholder="t('bubble.feedbackPlaceholder')"
      ></textarea>
    </div>

    <div class="footer-buttons">
      <span class="footer-hint">
        <template v-if="!canApprove">↓ scroll to end to Approve</template>
        <template v-else>✓ {{ t('bubble.gotIt') }}</template>
      </span>
      <span style="flex: 1;"></span>
      <button
        class="footer-button reject"
        @click="reject"
        :disabled="!canReject"
      >
        {{ t('bubble.reject') }}
      </button>
      <button
        class="footer-button approve"
        @click="approve"
        :disabled="!canApprove"
      >
        {{ t('bubble.approve') }}
      </button>
    </div>
  </div>
</template>
