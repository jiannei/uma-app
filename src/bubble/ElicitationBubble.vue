<script setup lang="ts">
// src/bubble/ElicitationBubble.vue — Elicitation (AskUserQuestion)
// renderer.
//
// Multi-step form: one question active at a time, with Back / Next
// or Submit navigation. Each question has radio buttons (or
// checkboxes for multiSelect) for the options provided by the
// agent, plus a synthetic "Other" option with a free-text textarea.
// On Submit, builds the canonical `updatedInput.answers` map
// (keyed by `question.question` per CC's protocol) and dispatches
// the decision via `respond_permission` with `behavior: "allow"`.

import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type {
  ElicitationQuestion,
  ElicitationRequest,
  PermissionDecision,
} from "../types/permission";
import { bubbleText, type Lang } from "./strings";

const lang: Lang = "en"; // v1.1: hardcoded; settings-driven in v1.2

// Sentinel index for the "Other" option appended to every question's
// options list. We keep it outside the array bounds so it doesn't
// collide with the agent-provided option indices.
const OTHER = Symbol("other");

interface AnswerState {
  /** Indices into questions[i].options + `OTHER` for the synthetic
   * "Other" option. For single-select, length is 0 or 1. */
  selected: (number | symbol)[];
  /** Free-text input for the "Other" option. */
  otherText: string;
}

const props = defineProps<{
  request: ElicitationRequest;
}>();

const questions = computed(() => props.request.questions);
const activeIndex = ref(0);
const answers = ref<AnswerState[]>([]);

// Lazily initialize answer state for a question.
function ensureAnswer(qIndex: number): AnswerState {
  if (!answers.value[qIndex]) {
    answers.value[qIndex] = { selected: [], otherText: "" };
  }
  return answers.value[qIndex];
}

const currentQ = computed<ElicitationQuestion | null>(() => {
  return questions.value[activeIndex.value] ?? null;
});

const currentAnswer = computed<AnswerState>(() => ensureAnswer(activeIndex.value));

function setSelected(
  qIndex: number,
  optionKey: number | symbol,
  checked: boolean,
) {
  const ans = ensureAnswer(qIndex);
  const q = questions.value[qIndex];
  if (q.multiSelect) {
    if (checked) {
      if (!ans.selected.includes(optionKey)) ans.selected.push(optionKey);
    } else {
      ans.selected = ans.selected.filter((k) => k !== optionKey);
    }
  } else {
    // Single-select: replace (or clear if un-checking).
    if (checked) {
      ans.selected = [optionKey];
    } else if (ans.selected.length === 1 && ans.selected[0] === optionKey) {
      ans.selected = [];
    }
  }
}

const isOther = (k: number | symbol): boolean => k === OTHER;

function isSelected(qIndex: number, k: number | symbol): boolean {
  return (answers.value[qIndex]?.selected ?? []).includes(k);
}

function setOtherText(qIndex: number, text: string) {
  const ans = ensureAnswer(qIndex);
  ans.otherText = text;
}

/** The answer text for one question, mirroring uma-pet's
 * `getElicitationAnswerText` (labels joined with ", ", or the
 * "Other" textarea if selected). Empty string when no answer. */
function getAnswerText(qIndex: number): string {
  const ans = answers.value[qIndex];
  const q = questions.value[qIndex];
  if (!ans || ans.selected.length === 0) return "";
  const parts: string[] = [];
  for (const k of ans.selected) {
    if (isOther(k)) {
      const trimmed = ans.otherText.trim();
      if (trimmed) parts.push(trimmed);
    } else {
      const opt = q.options[k as number];
      if (opt?.label) parts.push(opt.label);
    }
  }
  return parts.join(", ");
}

const canProceed = computed<boolean>(() => {
  return getAnswerText(activeIndex.value).length > 0;
});

const isLastQuestion = computed<boolean>(
  () => activeIndex.value >= questions.value.length - 1,
);

function back() {
  if (activeIndex.value > 0) activeIndex.value -= 1;
}

function next() {
  if (!canProceed.value) return;
  if (!isLastQuestion.value) activeIndex.value += 1;
}

const sending = ref(false);

async function submit() {
  if (!canProceed.value || sending.value) return;
  // Build answers map keyed by question.question (per CC protocol).
  const answersMap: Record<string, string> = {};
  for (let i = 0; i < questions.value.length; i++) {
    const text = getAnswerText(i);
    if (text) answersMap[questions.value[i].question] = text;
  }
  // updatedInput replaces the entire tool_input per CC docs.
  const updatedInput = {
    ...(props.request.toolInput ?? {}),
    questions: questions.value,
    answers: answersMap,
  };
  const decision: PermissionDecision = {
    requestId: props.request.requestId,
    behavior: "allow",
    updatedInput,
  };
  sending.value = true;
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
    sending.value = false;
  }
}
</script>

<template>
  <div v-if="currentQ" class="kind elicitation">
    <header>
      <span class="icon">❓</span>
      <span class="title">
        {{ bubbleText(lang, "needsInput", { agent: props.request.agentDisplayName }) }}
      </span>
      <span class="progress">
        {{ bubbleText(lang, "questionProgress", { current: activeIndex + 1, total: questions.length }) }}
      </span>
    </header>

    <div class="question-card">
      <h3 class="question-header">{{ currentQ.header }}</h3>
      <p class="question-text">{{ currentQ.question }}</p>
      <p class="hint">
        {{ bubbleText(lang, currentQ.multiSelect ? "chooseAtLeastOneOption" : "chooseOneOption") }}
      </p>

      <div class="options">
        <label
          v-for="(option, optIndex) in currentQ.options"
          :key="optIndex"
          class="option"
        >
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="optIndex"
            :checked="isSelected(activeIndex, optIndex)"
            :disabled="sending"
            @change="
              setSelected(
                activeIndex,
                optIndex,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <div class="option-content">
            <div class="option-label">{{ option.label }}</div>
            <div v-if="option.description" class="option-description">
              {{ option.description }}
            </div>
            <pre v-if="option.preview" class="option-preview">{{
              option.preview
            }}</pre>
          </div>
        </label>

        <!-- Synthetic "Other" option. -->
        <label class="option other-option">
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="OTHER"
            :checked="isSelected(activeIndex, OTHER)"
            :disabled="sending"
            @change="
              setSelected(
                activeIndex,
                OTHER,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <div class="option-content">
            <div class="option-label">{{ bubbleText(lang, "other") }}</div>
            <textarea
              v-if="isSelected(activeIndex, OTHER)"
              class="other-textarea"
              :placeholder="bubbleText(lang, 'otherPlaceholder')"
              :value="currentAnswer.otherText"
              :disabled="sending"
              @input="
                setOtherText(
                  activeIndex,
                  ($event.target as HTMLTextAreaElement).value,
                )
              "
            />
          </div>
        </label>
      </div>
    </div>

    <div class="actions">
      <button
        v-if="activeIndex > 0"
        class="btn secondary"
        :disabled="sending"
        @click="back"
      >
        {{ bubbleText(lang, "previousQuestion") }}
      </button>
      <button
        v-if="!isLastQuestion"
        class="btn primary"
        :disabled="!canProceed || sending"
        @click="next"
      >
        {{ bubbleText(lang, "nextQuestion") }}
      </button>
      <button
        v-else
        class="btn primary"
        :disabled="!canProceed || sending"
        @click="submit"
      >
        {{ bubbleText(lang, "submitAnswer") }}
      </button>
      <button
        class="btn deny"
        :disabled="sending"
        @click="
          invoke('respond_permission', {
            decision: {
              requestId: props.request.requestId,
              behavior: 'deny',
              message: 'Elicitation answered in terminal',
            } satisfies PermissionDecision,
          })
        "
      >
        {{ bubbleText(lang, "deny") }}
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
  background: #f9e2af;
  border-radius: 50%;
  color: #1e1e2e;
}

.title {
  font-weight: 600;
  flex: 1;
  color: #cdd6f4;
}

.progress {
  font-family: monospace;
  font-size: 10px;
  color: #a6adc8;
  background: #313244;
  padding: 2px 8px;
  border-radius: 4px;
}

.question-card {
  background: #1e1e2e;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.question-header {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #f9e2af;
  font-weight: 600;
  margin: 0;
}

.question-text {
  font-size: 13px;
  color: #cdd6f4;
  line-height: 1.4;
  margin: 0;
}

.hint {
  font-size: 11px;
  color: #6c7086;
  font-style: italic;
  margin: 0;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
}

.option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: #11111b;
  border: 1px solid #313244;
  border-radius: 4px;
  cursor: pointer;
}

.option:hover {
  background: #181825;
}

.option input {
  margin-top: 2px;
  cursor: pointer;
}

.option-content {
  flex: 1;
  min-width: 0;
}

.option-label {
  font-size: 12px;
  font-weight: 500;
  color: #cdd6f4;
}

.option-description {
  font-size: 11px;
  color: #a6adc8;
  margin-top: 2px;
  line-height: 1.4;
}

.option-preview {
  font-family: monospace;
  font-size: 10px;
  color: #6c7086;
  background: #1e1e2e;
  padding: 4px 6px;
  border-radius: 3px;
  margin: 4px 0 0;
  white-space: pre-wrap;
  max-height: 80px;
  overflow: auto;
}

.other-textarea {
  width: 100%;
  min-height: 60px;
  margin-top: 6px;
  background: #1e1e2e;
  color: #cdd6f4;
  border: 1px solid #45475a;
  border-radius: 3px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  resize: vertical;
}

.other-textarea:focus {
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
  background: #313244;
  color: #cdd6f4;
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
.btn.secondary { background: #89b4fa; color: #1e1e2e; }
.btn.deny { background: #f38ba8; color: #1e1e2e; }
</style>
