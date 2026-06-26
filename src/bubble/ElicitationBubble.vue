<script setup lang="ts">
// src/bubble/ElicitationBubble.vue — Elicitation (AskUserQuestion) 展开态。
//
// v5 + v6 轻改：
// - 删 "Claude Code needs input" header + "1/2" tag
// - 删底部 Submit/Deny 按钮（决策在 pill）
// - 删 DATABASE h3 + bg-muted 包裹（v6 — pill 已有 DATABASE 标签 + 背景统一）
// - 暴露 goNextOrSubmit 给父级

import { ref, computed } from "vue";
import type {
  ElicitationQuestion,
  ElicitationRequest,
} from "../types/permission";
import { bubbleText, type Lang } from "./strings";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const lang: Lang = "en";

const OTHER = Symbol("other");

interface AnswerState {
  selected: (number | symbol)[];
  otherText: string;
}

const props = defineProps<{
  request: ElicitationRequest;
}>();

const emit = defineEmits<{
  submit: [updatedInput: unknown];
}>();

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

const currentAnswer = computed<AnswerState>(() =>
  ensureAnswer(activeIndex.value),
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

const isOther = (k: number | symbol): boolean => k === OTHER;

function isSelected(qIndex: number, k: number | symbol): boolean {
  return (answers.value[qIndex]?.selected ?? []).includes(k);
}

function setOtherText(qIndex: number, text: string) {
  const ans = ensureAnswer(qIndex);
  ans.otherText = text;
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
  if (!isLastQuestion.value) {
    activeIndex.value += 1;
    return;
  }
  emit("submit", buildUpdatedInput());
}

defineExpose({ goNextOrSubmit });
</script>

<template>
  <div
    v-if="currentQ"
    class="expanded-shell flex flex-col gap-2 p-3 text-[13px] select-none w-full"
  >
    <!-- v6 轻改：删 bg-muted + DATABASE h3（pill 已有 + 背景统一） -->
    <div class="flex flex-col gap-1.5 overflow-y-auto">
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
          class="flex items-start gap-2 p-1.5 border border-border/40 rounded cursor-pointer hover:bg-muted/50"
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
            <div class="text-[12px] font-medium text-foreground">{{ option.label }}</div>
            <div
              v-if="option.description"
              class="text-[11px] text-muted-foreground mt-0.5 leading-snug"
            >
              {{ option.description }}
            </div>
            <pre
              v-if="option.preview"
              class="font-mono text-[10px] text-muted-foreground bg-muted/30 py-1 px-1.5 rounded mt-1 whitespace-pre-wrap max-h-[80px] overflow-auto m-0"
            >{{ option.preview }}</pre>
          </div>
        </Label>

        <Label class="flex items-start gap-2 p-1.5 border border-border/40 rounded cursor-pointer hover:bg-muted/50">
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
            <div class="text-[12px] font-medium text-foreground">{{ bubbleText(lang, "other") }}</div>
            <Textarea
              v-if="isSelected(activeIndex, OTHER)"
              class="mt-1.5 text-[12px] min-h-[60px]"
              :placeholder="bubbleText(lang, 'otherPlaceholder')"
              :model-value="currentAnswer.otherText"
              @update:model-value="(v: any) => setOtherText(activeIndex, String(v))"
            />
          </div>
        </Label>
      </div>
    </div>

    <div v-if="activeIndex > 0" class="flex-shrink-0">
      <Button
        variant="ghost"
        size="sm"
        class="text-[11px] h-7 px-2 text-muted-foreground"
        @click="back"
      >
        {{ bubbleText(lang, "previousQuestion") }}
      </Button>
    </div>
  </div>
</template>
