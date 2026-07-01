<script setup lang="ts">
// src/bubble/ElicitationBody.vue — single-question rendering for
// Elicitation kind. The parent (UnifiedBubbleCard) drives which
// question is active; we render it here plus summary buttons for
// already-answered questions (clickable to jump back).
//
// Props:
//   - questions: ElicitationQuestion[] (full list)
//   - activeIndex: number (which question to render now)
//   - answers: v-model of the parent's answers ref (Array<{selected, otherText}>)
//
// Emits:
//   - "update:activeIndex": user clicked a summary to jump back
//   - "update:answers": user selected an option or typed "Other"
//
// Keyboard:
//   - 1-9: quick-select option (handled by UnifiedBubbleCard.onKeydown)
//   - Enter / Esc: handled by UnifiedBubbleCard (no local listener)
//
// Other auto-injection: we add an "Other" option at the end of every
// question regardless of what the agent sent (mirrors uma-pet's
// bubble-renderer.js:541-610 behavior — CC's AskUserQuestion protocol
// provides "Other" in terminal UI but not in question.options).

import { watch, nextTick } from "vue";
import type {
  ElicitationQuestion,
  ElicitationOption,
} from "@/types/permission";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  questions: ElicitationQuestion[];
  activeIndex: number;
  answers: Array<{ selected: (number | string)[]; otherText: string }>;
}>();

const emit = defineEmits<{
  (e: "update:activeIndex", value: number): void;
  (e: "update:answers", value: Array<{ selected: (number | string)[]; otherText: string }>): void;
}>();

// The "Other" option is injected client-side at a sentinel index
// (questions[i].options.length). Real options have index 0..N-1;
// Other is index N.
const OTHER_KEY = "__other__";

function currentAnswer() {
  return props.answers[props.activeIndex] ?? { selected: [], otherText: "" };
}

function isOtherSelected(): boolean {
  return currentAnswer().selected.includes(OTHER_KEY);
}

function selectOption(optionIndex: number) {
  const answers = [...props.answers];
  const ans = {
    ...answers[props.activeIndex],
    selected: [...(answers[props.activeIndex]?.selected ?? [])],
    otherText: answers[props.activeIndex]?.otherText ?? "",
  };
  const q = props.questions[props.activeIndex];
  if (!q) return;

  if (q.multiSelect) {
    const idx = ans.selected.indexOf(optionIndex);
    if (idx >= 0) {
      ans.selected.splice(idx, 1);
    } else {
      ans.selected.push(optionIndex);
    }
  } else {
    ans.selected = [optionIndex];
  }

  answers[props.activeIndex] = ans;
  emit("update:answers", answers);
}

function selectOther() {
  const answers = [...props.answers];
  const ans = {
    ...answers[props.activeIndex],
    selected: [...(answers[props.activeIndex]?.selected ?? [])],
    otherText: answers[props.activeIndex]?.otherText ?? "",
  };
  const q = props.questions[props.activeIndex];
  if (!q) return;

  if (q.multiSelect) {
    const idx = ans.selected.indexOf(OTHER_KEY);
    if (idx >= 0) {
      ans.selected.splice(idx, 1);
      ans.otherText = "";
    } else {
      ans.selected.push(OTHER_KEY);
    }
  } else {
    ans.selected = [OTHER_KEY];
  }

  answers[props.activeIndex] = ans;
  emit("update:answers", answers);
}

function updateOtherText(text: string) {
  const answers = [...props.answers];
  const ans = {
    ...answers[props.activeIndex],
    selected: [...(answers[props.activeIndex]?.selected ?? [])],
    otherText: text,
  };
  answers[props.activeIndex] = ans;
  emit("update:answers", answers);
}

function jumpTo(qIndex: number) {
  if (qIndex !== props.activeIndex) {
    emit("update:activeIndex", qIndex);
  }
}

// Auto-focus the first preset radio on render (uma-pet bubble-renderer.js:676)
watch(
  () => props.activeIndex,
  async () => {
    await nextTick();
    const q = props.questions[props.activeIndex];
    if (!q) return;
    const first = document.querySelector<HTMLInputElement>(
      `input[name="elicitation-${props.activeIndex}"]:not([data-other])`,
    );
    if (first) {
      first.focus();
      // Re-check any already-selected answer
      const ans = currentAnswer();
      if (ans.selected.length > 0) {
        const checked = document.querySelector<HTMLInputElement>(
          `input[name="elicitation-${props.activeIndex}"]:checked`,
        );
        if (checked) checked.focus();
      }
    }
  },
  { immediate: true },
);

// Enter on Other textarea submits (delegated via UnifiedBubbleCard),
// ArrowUp from the start of Other returns focus to the last preset option.
function onOtherKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowUp" && !e.shiftKey) {
    const target = e.target as HTMLTextAreaElement;
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
    const isEmpty = target.value.length === 0;
    if (isEmpty || atStart) {
      e.preventDefault();
      const q = props.questions[props.activeIndex];
      if (!q) return;
      const lastPreset = document.querySelector<HTMLInputElement>(
        `input[name="elicitation-${props.activeIndex}"]:not([data-other])`,
      );
      // Select last preset in radio mode
      if (lastPreset && !q.multiSelect) {
        const allPresets = document.querySelectorAll<HTMLInputElement>(
          `input[name="elicitation-${props.activeIndex}"]:not([data-other])`,
        );
        const last = allPresets[allPresets.length - 1];
        if (last) {
          last.focus();
          last.click();
        }
      } else if (lastPreset) {
        lastPreset.focus();
      }
    }
  }
}

function onPresetKeydown(e: KeyboardEvent) {
  if (e.key === "ArrowDown" && !e.shiftKey) {
    // Move focus into the Other textarea if visible
    const other = document.querySelector<HTMLInputElement>(
      `input[name="elicitation-${props.activeIndex}"][data-other]`,
    );
    if (other) {
      e.preventDefault();
      other.focus();
    }
  }
}

function isQuestionAnswered(qIndex: number): boolean {
  const ans = props.answers[qIndex];
  if (!ans) return false;
  return ans.selected.length > 0 || ans.otherText.trim().length > 0;
}

function getOptionLabel(option: ElicitationOption, idx: number): string {
  return option.label || String(idx + 1);
}

function getAnswerSummary(qIndex: number): string {
  const q = props.questions[qIndex];
  const ans = props.answers[qIndex];
  if (!q || !ans || ans.selected.length === 0) return ans?.otherText?.trim() ?? "";
  const parts: string[] = [];
  for (const sel of ans.selected) {
    if (sel === OTHER_KEY) {
      parts.push(ans.otherText.trim() || t("bubble.other"));
    } else {
      // sel is a numeric option index here
      const idx = typeof sel === "number" ? sel : parseInt(String(sel), 10);
      if (!Number.isNaN(idx) && q.options[idx]) {
        parts.push(getOptionLabel(q.options[idx], idx));
      }
    }
  }
  return parts.join(", ");
}
</script>

<template>
  <div class="elicitation-body">
    <!-- Summary buttons for already-answered questions (click to jump back) -->
    <div
      v-for="(q, qi) in questions"
      :key="`summary-${qi}`"
      class="summary-slot"
    >
      <button
        v-if="qi !== activeIndex && isQuestionAnswered(qi)"
        class="question-summary"
        @click="jumpTo(qi)"
      >
        <span class="question-summary-title">
          {{ q.header || t("bubble.questionLabel", { index: qi + 1 }) }}
        </span>
        <span class="question-summary-answer">
          {{ getAnswerSummary(qi) }}
        </span>
      </button>
    </div>

    <!-- Current question card -->
    <div v-if="questions[activeIndex]" class="question-card">
      <div class="question-header">
        {{ questions[activeIndex].header || t("bubble.questionLabel", { index: activeIndex + 1 }) }}
      </div>
      <div class="question-text">
        {{ questions[activeIndex].question }}
      </div>
      <div class="question-hint">
        {{
          questions[activeIndex].multiSelect
            ? t("bubble.chooseAtLeastOneOption")
            : t("bubble.chooseOneOption")
        }}
      </div>

      <div class="option-list">
        <label
          v-for="(opt, oi) in questions[activeIndex].options"
          :key="oi"
          class="option-item"
          :class="{ selected: currentAnswer().selected.includes(oi) }"
        >
          <input
            :type="questions[activeIndex].multiSelect ? 'checkbox' : 'radio'"
            :name="`elicitation-${activeIndex}`"
            :value="opt.label"
            :checked="currentAnswer().selected.includes(oi)"
            @change="selectOption(oi)"
            @keydown="onPresetKeydown($event)"
          />
          <div class="option-item-copy">
            <span class="option-item-label">
              {{ getOptionLabel(opt, oi) }}
            </span>
            <span
              v-if="opt.description"
              class="option-item-description"
            >
              {{ opt.description }}
            </span>
          </div>
        </label>

        <!-- Auto-injected "Other" option (uma-pet bubble-renderer.js:541-610) -->
        <label class="option-item option-item-other">
          <input
            type="checkbox"
            v-if="questions[activeIndex].multiSelect"
            :name="`elicitation-${activeIndex}`"
            data-other="true"
            :checked="isOtherSelected()"
            @change="selectOther"
          />
          <input
            v-else
            type="radio"
            :name="`elicitation-${activeIndex}`"
            data-other="true"
            :checked="isOtherSelected()"
            @change="selectOther"
          />
          <div class="option-item-copy">
            <span class="option-item-label">
              {{ t("bubble.other") }}
            </span>
          </div>
        </label>

        <textarea
          v-if="isOtherSelected()"
          class="option-item-textarea visible"
          :placeholder="t('bubble.otherPlaceholder')"
          :value="currentAnswer().otherText"
          data-other-textarea="true"
          @input="updateOtherText(($event.target as HTMLTextAreaElement).value)"
          @keydown="onOtherKeydown"
        ></textarea>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Tighten spacing between summary-slot rows so they don't visually
   overwhelm the current question card. */
.summary-slot {
  margin-bottom: 4pt;
}
</style>