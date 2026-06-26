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
import { HelpCircle } from "@lucide/vue";
import type {
  ElicitationQuestion,
  ElicitationRequest,
  PermissionDecision,
} from "../types/permission";
import { bubbleText, type Lang } from "./strings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import BubbleHeader from "@/components/bubble/BubbleHeader.vue";

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

const emit = defineEmits<{
  decide: [decision: PermissionDecision];
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

function submit() {
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
  sending.value = true;
  emit("decide", {
    requestId: props.request.requestId,
    behavior: "allow",
    updatedInput,
  });
}

function deny() {
  if (sending.value) return;
  sending.value = true;
  emit("decide", {
    requestId: props.request.requestId,
    behavior: "deny",
    message: "Elicitation answered in terminal",
  });
}
</script>

<template>
  <!--
    Elicitation 全填 480×360（ADR-0013 固定 webview）。
    header 顶 / 按钮底固定；问题 + 选项区 flex-1 + 内部滚动。
  -->
  <div v-if="currentQ" class="expanded-shell flex flex-col gap-2.5 p-3 text-[13px] select-none w-full h-full min-h-0">
    <BubbleHeader
      :icon="HelpCircle"
      variant="accent"
      :title="bubbleText(lang, 'needsInput', { agent: props.request.agentDisplayName })"
      :tag="bubbleText(lang, 'questionProgress', { current: activeIndex + 1, total: questions.length })"
    />

    <div class="bg-muted rounded-md p-2.5 flex flex-col gap-1.5 flex-1 min-h-0 overflow-y-auto">
      <h3 class="text-[10px] uppercase tracking-wider text-accent font-semibold m-0">
        {{ currentQ.header }}
      </h3>
      <p class="text-[13px] text-foreground leading-snug m-0">
        {{ currentQ.question }}
      </p>
      <p class="text-[11px] text-muted-foreground italic m-0">
        {{ bubbleText(lang, currentQ.multiSelect ? "chooseAtLeastOneOption" : "chooseOneOption") }}
      </p>

      <div class="flex flex-col gap-1.5 mt-1">
        <Label
          v-for="(option, optIndex) in currentQ.options"
          :key="optIndex"
          class="flex items-start gap-2 p-1.5 bg-background border border-border rounded cursor-pointer hover:bg-muted"
        >
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="optIndex"
            :checked="isSelected(activeIndex, optIndex)"
            :disabled="sending"
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
            <div class="text-[12px] font-medium text-foreground">{{ option.label }}</div>
            <div v-if="option.description" class="text-[11px] text-muted-foreground mt-0.5 leading-snug">
              {{ option.description }}
            </div>
            <pre v-if="option.preview" class="font-mono text-[10px] text-muted-foreground bg-muted py-1 px-1.5 rounded mt-1 whitespace-pre-wrap max-h-[80px] overflow-auto m-0">
              {{ option.preview }}
            </pre>
          </div>
        </Label>

        <!-- Synthetic "Other" option. -->
        <Label class="flex items-start gap-2 p-1.5 bg-background border border-border rounded cursor-pointer hover:bg-muted">
          <input
            :type="currentQ.multiSelect ? 'checkbox' : 'radio'"
            :name="`q-${activeIndex}`"
            :value="OTHER"
            :checked="isSelected(activeIndex, OTHER)"
            :disabled="sending"
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
            <div class="text-[12px] font-medium text-foreground">{{ bubbleText(lang, "other") }}</div>
            <Textarea
              v-if="isSelected(activeIndex, OTHER)"
              class="mt-1.5 text-[12px] min-h-[60px]"
              :placeholder="bubbleText(lang, 'otherPlaceholder')"
              :model-value="currentAnswer.otherText"
              :disabled="sending"
              @update:model-value="(v: any) => setOtherText(activeIndex, String(v))"
            />
          </div>
        </Label>
      </div>
    </div>

    <div class="flex gap-1.5 mt-auto flex-shrink-0">
      <Button
        v-if="activeIndex > 0"
        variant="secondary"
        class="flex-1"
        :disabled="sending"
        @click="back"
      >
        {{ bubbleText(lang, "previousQuestion") }}
      </Button>
      <Button
        v-if="!isLastQuestion"
        variant="default"
        class="flex-1"
        :disabled="!canProceed || sending"
        @click="next"
      >
        {{ bubbleText(lang, "nextQuestion") }}
      </Button>
      <Button
        v-else
        variant="default"
        class="flex-1"
        :disabled="!canProceed || sending"
        @click="submit"
      >
        {{ bubbleText(lang, "submitAnswer") }}
      </Button>
      <Button
        variant="destructive"
        class="flex-1"
        :disabled="sending"
        @click="deny"
      >
        {{ bubbleText(lang, "deny") }}
      </Button>
    </div>
  </div>
</template>
