<script setup lang="ts">
// src/bubble/PlanBody.vue — PlanReview body (plan content + suggestion
// entry for rejection / terminal handoff).
//
// The plan text is rendered as-is (no max-height clamp — user reads
// the whole thing; bubble height adapts via ResizeObserver + IPC,
// see BubbleShellRoot).
//
// Suggestions:
//   - "Tell Claude what to change" → emits 'request-feedback'
//     (parent opens the feedback textarea, user types reason,
//     then the parent emits deny with the feedback text)
//   - "Go to terminal" → emits 'go-to-terminal'
//     (parent emits deny with handoff message)
import { useI18n } from "vue-i18n";

const { t } = useI18n();

defineProps<{
  content: string;
}>();

const emit = defineEmits<{
  (e: "request-feedback"): void;
  (e: "go-to-terminal"): void;
}>();
</script>

<template>
  <div class="plan-body">
    <pre class="plan-text">{{ content || "(no plan content)" }}</pre>

    <div class="suggestions">
      <button class="btn-suggestion" @click="emit('request-feedback')">
        {{ t("bubble.tellClaudeToChange") }}
      </button>
      <button class="btn-suggestion" @click="emit('go-to-terminal')">
        {{ t("bubble.goToTerminal") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.plan-text {
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  font-size: 11pt;
  line-height: 1.5;
  padding: 10pt 12pt;
  background: oklch(0.12 0 0 / 0.4);
  border: 1px solid var(--border-island, oklch(1 0 0 / 0.08));
  border-radius: 10pt;
  color: oklch(0.90 0 0);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
</style>