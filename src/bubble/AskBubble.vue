<script setup lang="ts">
// src/bubble/AskBubble.vue — Elicitation (AskUserQuestion) 展开态（ADR-0017 Q4）。
//
// 分步导航：一次一题，顶部 progress dots，底部只有 ← Back。
// pill → 触发 goNextOrSubmit（中间题→Next/最后一题→Submit）。
//
// emit:
//   "submit" + updatedInput  →  Submit（reply: allow + updatedInput.answers）
//   "deny"                   →  Deny（reply: deny + message）
//
// `↗` chevron 在 BubblePill 里对 ask 场景永远隐藏（一个 ask request = N 题，
// 没有"跳到下一 request"概念）。

import { ref, computed } from "vue";
import type {
  ElicitationQuestion,
  ElicitationRequest,
} from "../types/permission";
import { useBubbleLang } from "./lang";
import { bubbleText } from "./strings";

const lang = useBubbleLang();

const props = defineProps<{
  request: ElicitationRequest;
}>();

const emit = defineEmits<{
  submit: [updatedInput: unknown];
  deny: [];
}>();

const OTHER = Symbol("other");

interface AnswerState {
  selected: Array<number | symbol>;
  otherText: string;
}

const questions = computed(() => props.request.questions);
const activeIndex = ref(0);
const answers = ref<AnswerState[]>([]);

function ensureAnswer(qIndex: number): AnswerState {
  if (!answers.value[qIndex]) {
    answers.value[qIndex] = { selected: [], otherText: "" };
  }
  return answers.value[qIndex];
}

const currentQ = computed<ElicitationQuestion | null>(
  () => questions.value[activeIndex.value] ?? null,
);

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
    if (checked) {
      ans.selected = [optionKey];
    } else if (ans.selected.length === 1 && ans.selected[0] === optionKey) {
      ans.selected = [];
    }
  }
}

function isOther(k: number | symbol): boolean {
  return k === OTHER;
}

function isSelected(qIndex: number, k: number | symbol): boolean {
  return (answers.value[qIndex]?.selected ?? []).includes(k);
}

function setOtherText(qIndex: number, text: string) {
  ensureAnswer(qIndex).otherText = text;
}

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

const canProceed = computed<boolean>(
  () => getAnswerText(activeIndex.value).length > 0,
);

const isFirstQuestion = computed<boolean>(() => activeIndex.value === 0);
const isLastQuestion = computed<boolean>(
  () => activeIndex.value >= questions.value.length - 1,
);

function back() {
  if (activeIndex.value > 0) activeIndex.value -= 1;
}

function buildUpdatedInput(): unknown {
  const answersMap: Record<string, string> = {};
  for (let i = 0; i < questions.value.length; i++) {
    const text = getAnswerText(i);
    if (text) answersMap[questions.value[i].question] = text;
  }
  return {
    ...(props.request.toolInput ?? {}),
    questions: questions.value,
    answers: answersMap,
  };
}

function goNextOrSubmit() {
  if (!canProceed.value) return;
  if (isLastQuestion.value) {
    emit("submit", buildUpdatedInput());
  } else {
    activeIndex.value += 1;
  }
}

defineExpose({ goNextOrSubmit });
</script>

<template>
  <div
    v-if="currentQ"
    class="flex flex-col gap-2 p-3 text-[13px] select-none w-full"
  >
    <!-- Progress dots + counter -->
    <div class="flex items-center justify-between py-1 px-0.5 flex-shrink-0">
      <span class="text-[11px] text-[var(--muted-foreground)] tabular-nums">
        Q{{ activeIndex + 1 }} / {{ questions.length }}
      </span>
      <div class="inline-flex gap-1.5 items-center">
        <button
          v-for="(_, i) in questions"
          :key="i"
          type="button"
          :class="[
            'w-1.5 h-1.5 rounded-full border border-[var(--muted-foreground)] bg-transparent p-0 cursor-pointer transition-[transform,background,border-color] duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--island)]',
            i === activeIndex && 'w-2 h-2 bg-[var(--foreground)] border-[var(--foreground)]',
            i < activeIndex && 'bg-[var(--muted-foreground)] border-[var(--muted-foreground)]',
          ]"
          :aria-label="`Go to question ${i + 1}`"
          @click="activeIndex = i"
        />
      </div>
    </div>

    <!-- Current question + options -->
    <div class="flex flex-col gap-1.5 overflow-y-auto max-h-[260px]">
      <p class="text-[13px] text-[var(--foreground)] leading-snug m-0">
        {{ currentQ.question }}
      </p>
      <p class="text-[11px] text-[var(--muted-foreground)] italic m-0">
        {{ currentQ.multiSelect ? bubbleText(lang, "chooseAtLeastOneOption") : bubbleText(lang, "chooseOneOption") }}
      </p>

      <div class="flex flex-col gap-1 mt-1">
        <label
          v-for="(option, optIndex) in currentQ.options"
          :key="optIndex"
          class="flex items-start gap-2 p-1.5 border border-[var(--border)]/40 rounded cursor-pointer hover:bg-[var(--muted)]/50"
        >
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="optIndex"
            :checked="isSelected(activeIndex, optIndex)"
            class="mt-0.5 cursor-pointer"
            @change="
              setSelected(
                activeIndex,
                optIndex,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-medium text-[var(--foreground)]">{{ option.label }}</div>
            <div
              v-if="option.description"
              class="text-[11px] text-[var(--muted-foreground)] mt-0.5 leading-snug"
            >
              {{ option.description }}
            </div>
          </div>
        </label>

        <label class="flex items-start gap-2 p-1.5 border border-[var(--border)]/40 rounded cursor-pointer hover:bg-[var(--muted)]/50">
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="OTHER"
            :checked="isSelected(activeIndex, OTHER)"
            class="mt-0.5 cursor-pointer"
            @change="
              setSelected(
                activeIndex,
                OTHER,
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          <div class="flex-1 min-w-0">
            <div class="text-[12px] font-medium text-[var(--foreground)]">{{ bubbleText(lang, "other") }}</div>
            <textarea
              v-if="isSelected(activeIndex, OTHER)"
              class="mt-1.5 text-[12px] min-h-[60px] w-full bg-transparent border border-[var(--border)]/40 rounded p-1.5 font-sans resize-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)]"
              :placeholder="bubbleText(lang, 'otherPlaceholder')"
              :value="ensureAnswer(activeIndex).otherText"
              @input="setOtherText(activeIndex, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </label>
      </div>
    </div>

    <!-- Bottom: only ← Back (activeIndex > 0). Next/Submit lives on pill →. -->
    <div v-if="!isFirstQuestion" class="flex-shrink-0">
      <button
        type="button"
        class="text-[11px] h-7 px-2 text-[var(--muted-foreground)] bg-transparent border-0 cursor-pointer rounded hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)]"
        @click="back"
      >
        ← Back
      </button>
    </div>
  </div>
</template>
