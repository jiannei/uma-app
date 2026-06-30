<script setup lang="ts">
// src/bubble/AskPanelContent.vue — Elicitation panel content.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: ElicitationRequest
//
// Emits:
//   - "submit": user submitted answers (updatedInput)
//   - "deny": user denied

import { ref, computed } from "vue";
import type { ElicitationRequest } from "../types/permission";

const props = defineProps<{
  request: ElicitationRequest;
}>();

const emit = defineEmits<{
  (e: "submit", updatedInput: unknown): void;
  (e: "deny"): void;
}>();

const activeIndex = ref(0);
const answers = ref<Array<{ selected: number[]; otherText: string }>>([]);

const questions = computed(() => props.request.questions);
const currentQ = computed(() => questions.value[activeIndex.value] ?? null);

function ensureAnswer(qIndex: number) {
  if (!answers.value[qIndex]) {
    answers.value[qIndex] = { selected: [], otherText: "" };
  }
  return answers.value[qIndex];
}

function selectOption(qIndex: number, optionIndex: number) {
  const ans = ensureAnswer(qIndex);
  const q = questions.value[qIndex];
  if (q.multiSelect) {
    if (ans.selected.includes(optionIndex)) {
      ans.selected = ans.selected.filter((i) => i !== optionIndex);
    } else {
      ans.selected.push(optionIndex);
    }
  } else {
    ans.selected = [optionIndex];
  }
}

function nextOrSubmit() {
  if (activeIndex.value < questions.value.length - 1) {
    activeIndex.value++;
  } else {
    const updatedInput = {
      answers: answers.value.map((a, i) => ({
        question: questions.value[i].question,
        selectedOptions: a.selected.map((idx) => questions.value[i].options[idx].label),
        otherText: a.otherText,
      })),
    };
    emit("submit", updatedInput);
  }
}

function back() {
  if (activeIndex.value > 0) {
    activeIndex.value--;
  }
}

function deny() {
  emit("deny");
}
</script>

<template>
  <div class="ask-panel-content">
    <div v-if="currentQ" class="question-container">
      <div class="question-title">{{ currentQ.question }}</div>
      <div class="question-subtitle" v-if="currentQ.header">
        {{ currentQ.header }}
      </div>

      <div class="options-list">
        <label
          v-for="(opt, i) in currentQ.options"
          :key="i"
          class="option-label"
          :class="{ selected: answers[activeIndex]?.selected.includes(i) }"
          tabindex="0"
          @click="selectOption(activeIndex, i)"
        >
          <div
            class="option-indicator"
            :class="{
              radio: !currentQ.multiSelect,
              checkbox: currentQ.multiSelect,
              checked: answers[activeIndex]?.selected.includes(i),
            }"
          >
            <div
              v-if="answers[activeIndex]?.selected.includes(i)"
              class="indicator-check"
            ></div>
          </div>
          <span class="option-text">{{ opt.label }}</span>
          <span class="key-hint" v-if="i < 9">{{ i + 1 }}</span>
        </label>
      </div>
    </div>

    <div class="footer-buttons">
      <button
        class="footer-button back"
        @click="back"
        :disabled="activeIndex === 0"
      >
        <span class="key-hint">←</span> Back
      </button>
      <span style="flex: 1;"></span>
      <button class="footer-button deny" @click="deny">
        <span class="key-hint">esc</span> Deny
      </button>
      <button class="footer-button primary" @click="nextOrSubmit">
        {{ activeIndex < questions.length - 1 ? 'Next' : 'Submit' }}
        <span class="key-hint">↵</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.ask-panel-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.question-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.question-title {
  font-size: 15px;
  font-weight: 600;
}

.question-subtitle {
  color: #a1a1aa;
  font-size: 12px;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: background 200ms;
}

.option-label.selected {
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.4);
}

.option-indicator {
  width: 16px;
  height: 16px;
  border: 1.5px solid rgba(255, 255, 255, 0.3);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.option-indicator.radio {
  border-radius: 50%;
}

.option-indicator.checkbox {
  border-radius: 4px;
}

.option-indicator.checked {
  border-color: #f59e0b;
  background: #f59e0b;
}

.indicator-check {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #422006;
}

.option-text {
  flex: 1;
}

.key-hint {
  font-size: 10px;
  opacity: 0.5;
  font-family: ui-monospace, monospace;
}

.footer-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
}

.footer-button {
  height: 30px;
  padding: 0 14px;
  border-radius: 8px;
  border: none;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.footer-button.back {
  background: transparent;
  color: #a1a1aa;
}

.footer-button.back:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.footer-button.deny {
  background: rgba(255, 255, 255, 0.08);
  color: #f4f4f5;
}

.footer-button.primary {
  background: #f59e0b;
  color: #422006;
  font-weight: 600;
}
</style>
