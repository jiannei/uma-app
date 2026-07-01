<script setup lang="ts">
// src/bubble/UnifiedBubbleCard.vue — single card for all permission kinds.
// Spec: docs/superpowers/specs/2026-07-01-bubble-display-design.md (方案 B).
//
// Replaces PillShell + PanelShell. All three kinds (SideEffect / Elicitation
// / PlanReview) render through this one component, switching body by kind
// and adapting the footer layout to match uma-pet's footer semantics:
//   - SideEffect: [Deny] [Allow]
//   - Elicitation: [Back] [Next|Submit] (strict gate — all questions must
//     be answered before Submit is enabled)
//   - PlanReview: [Approve] single button; rejection with feedback goes
//     through a suggestion-button entry in the suggestions list.
//
// Props:
//   - request: PermissionRequest (discriminated union)
//
// Emits:
//   - "allow": user clicked the primary action (Allow / Next / Approve)
//     Elicitation carries { updatedInput }; SideEffect / PlanReview none.
//   - "deny": user clicked the secondary action (Deny / Back / Reject)
//     PlanReview feedback path emits { message: feedback }.

import { ref, computed } from "vue";
import type { PermissionRequest, PermissionUpdateEntry } from "../types/permission";
import { useToolColor } from "./composables/useToolColor";
import { sessionShortId } from "./utils/sessionShortId";
import { useI18n } from "vue-i18n";
import CommandBlock from "./CommandBlock.vue";
import SuggestionList from "./SuggestionList.vue";
import ElicitationBody from "./ElicitationBody.vue";
import PlanBody from "./PlanBody.vue";

const props = defineProps<{
  request: PermissionRequest;
}>();

const emit = defineEmits<{
  (
    e: "allow",
    payload?: { updatedInput?: unknown; updatedPermissions?: PermissionUpdateEntry[] },
  ): void;
  (e: "deny", message?: string): void;
}>();

// Expose card ref for BubbleShellRoot's ResizeObserver to observe.
// The card's natural height drives the Tauri window size via IPC.
const cardRef = ref<HTMLElement | null>(null);
defineExpose({ cardRef });

const { t } = useI18n();

// ── Shared state ──
const isSubmitting = ref(false); // true after user clicks any action button
const denyClicked = ref(false); // tracks which footer button was clicked last

// ── SideEffect view ──
const sideEffect = computed(() =>
  props.request.kind === "SideEffect" ? props.request : null,
);
const { pillHex: sideEffectPillHex } = useToolColor(sideEffect.value?.toolName);
const preview = computed<string>(() => {
  const r = sideEffect.value;
  if (!r) return "";
  const input = (r.toolInput ?? {}) as Record<string, unknown>;
  // For Bash/Shell: prefer `description` (short, human-readable) when
  // present, fall back to the raw `command`. Mirrors uma-pet's
  // bubble-format.js:67-68 behavior: "prefer concrete fields, then
  // fall back to raw JSON." Claude Code's Bash tool sends both
  // `command` and `description` — the description is what users
  // actually want to see at a glance.
  if (r.toolName === "Bash" || r.toolName === "Shell") {
    const desc = firstString(input, ["description"]);
    if (desc) return desc;
    return firstString(input, ["command", "cmd"]);
  }
  if (
    r.toolName === "Edit" ||
    r.toolName === "Write" ||
    r.toolName === "Read" ||
    r.toolName === "NotebookEdit"
  ) {
    return firstString(input, ["file_path", "filePath", "path"]);
  }
  if (r.toolName === "Glob" || r.toolName === "Grep") {
    return firstString(input, ["pattern"]);
  }
  return JSON.stringify(r.toolInput ?? {}, null, 2);
});

// ── Elicitation state ──
const elicitation = computed(() =>
  props.request.kind === "Elicitation" ? props.request : null,
);
const elicitActiveIndex = ref(0);
const elicitAnswers = ref<
  Array<{ selected: (number | string)[]; otherText: string }>
>([]);

const elicitCurrentComplete = computed<boolean>(() => {
  const questions = elicitation.value?.questions;
  if (!questions) return false;
  const ans = elicitAnswers.value[elicitActiveIndex.value];
  if (!ans) return false;
  if (ans.selected.length > 0) return true;
  if (ans.otherText.trim().length > 0) return true;
  return false;
});

const elicitAllComplete = computed<boolean>(() => {
  const questions = elicitation.value?.questions;
  if (!questions) return false;
  return questions.every((_, i) => {
    const ans = elicitAnswers.value[i];
    if (!ans) return false;
    if (ans.selected.length > 0) return true;
    if (ans.otherText.trim().length > 0) return true;
    return false;
  });
});

const elicitSubmitEnabled = computed<boolean>(() => {
  const questions = elicitation.value?.questions;
  if (!questions) return false;
  const isLast = elicitActiveIndex.value === questions.length - 1;
  return isLast ? elicitAllComplete.value : elicitCurrentComplete.value;
});

const elicitProgressText = computed<string>(() => {
  const questions = elicitation.value?.questions;
  if (!questions || questions.length === 0) return "";
  return t("bubble.questionProgress", {
    current: elicitActiveIndex.value + 1,
    total: questions.length,
  });
});

// ── PlanReview state ──
const planReview = computed(() =>
  props.request.kind === "PlanReview" ? props.request : null,
);
const planFeedbackVisible = ref(false);
const planFeedback = ref("");
const planFeedbackEnabled = computed(
  () => planFeedback.value.trim().length > 0,
);

// ── Session tag ──
// ── Session tag ──
// Format: `folder · #shortId` (uma-pet convention). We derive the
// folder from `cwd` (already on PermissionBase) by taking its
// basename — this avoids needing a new `session_folder` field on
// the wire. If cwd is missing we fall back to shortId only.
const sessionTag = computed<string>(() => {
  const id = sessionShortId(props.request.sessionId);
  if (!id) return "";
  const folder = props.request.cwd?.split("/").filter(Boolean).pop();
  return folder ? `${folder} · #${id}` : `#${id}`;
});

// ── Header title per kind ──
const headerTitle = computed<string>(() => {
  switch (props.request.kind) {
    case "SideEffect":
      return t("bubble.permissionRequest");
    case "Elicitation":
      return t("bubble.needsInput");
    case "PlanReview":
      return t("bubble.planReview");
  }
});

// ── Action handlers ──
function onAllowOnce() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  denyClicked.value = false;
  emit("allow");
}

function onDeny() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  denyClicked.value = true;
  emit("deny");
}

function onPrev() {
  if (elicitActiveIndex.value > 0) {
    elicitActiveIndex.value--;
  }
}

function onNextOrSubmit() {
  if (isSubmitting.value) return;
  const questions = elicitation.value?.questions;
  if (!questions) return;
  if (elicitActiveIndex.value < questions.length - 1) {
    elicitActiveIndex.value++;
    return;
  }
  // Last question → submit
  if (!elicitAllComplete.value) return;
  isSubmitting.value = true;
  denyClicked.value = false;
  const updatedInput = {
    answers: elicitAnswers.value.map((a, i) => ({
      question: questions[i].question,
      // Filter out the sentinel OTHER_KEY; numeric indices only.
      selectedOptions: a.selected
        .filter((sel): sel is number => typeof sel === "number")
        .map((idx) => questions[i].options[idx]?.label ?? ""),
      otherText: a.otherText,
    })),
  };
  emit("allow", { updatedInput });
}

function onApprove() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  denyClicked.value = false;
  emit("allow");
}

function onRejectWithFeedback() {
  if (isSubmitting.value || !planFeedbackEnabled.value) return;
  isSubmitting.value = true;
  denyClicked.value = true;
  emit("deny", planFeedback.value.trim());
}

function onExitFeedback() {
  planFeedbackVisible.value = false;
  planFeedback.value = "";
}

function onSuggestionPick(s: PermissionUpdateEntry) {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  denyClicked.value = false;
  emit("allow", { updatedPermissions: [s] });
}

function onGoToTerminal() {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  denyClicked.value = true;
  emit("deny", "User chose to handle in terminal");
}

// ── Helpers ──
function firstString(
  input: Record<string, unknown>,
  names: readonly string[],
): string {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
</script>

<template>
  <div
    ref="cardRef"
    class="card"
    :data-kind="request.kind"
    :data-submitting="isSubmitting"
  >
    <!-- Header — two rows (uma-pet convention):
         row 1: title (e.g. "Permission Request" / "Needs Input" / "Plan review")
         row 2: tool pill + session tag (for SideEffect). Elicitation /
         PlanReview skip the pill but keep the session tag row. -->
    <div class="header">
      <div class="header-title-row">
        <span class="header-title">{{ headerTitle }}</span>
      </div>
      <div v-if="request.kind === 'SideEffect' || sessionTag" class="header-meta-row">
        <span
          v-if="request.kind === 'SideEffect'"
          class="tool-pill"
          :data-tool="sideEffect?.toolName || ''"
          :style="{ background: sideEffectPillHex }"
        >
          <span class="pill-text">{{ sideEffect?.toolName || "Tool" }}</span>
        </span>
        <span v-if="sessionTag" class="session-tag">{{ sessionTag }}</span>
      </div>
    </div>

    <!-- SideEffect body: command block only. SuggestionList lives
         below the footer (uma-pet convention) — keeps the primary
         action visually separate from the always-allow shortcuts. -->
    <template v-if="request.kind === 'SideEffect'">
      <CommandBlock :preview="preview" />
    </template>

    <!-- Elicitation body -->
    <template v-else-if="request.kind === 'Elicitation'">
      <div class="elicitation-progress">{{ elicitProgressText }}</div>
      <ElicitationBody
        :questions="elicitation!.questions"
        :active-index="elicitActiveIndex"
        :answers="elicitAnswers"
        @update:activeIndex="elicitActiveIndex = $event"
        @update:answers="elicitAnswers = $event"
      />
    </template>

    <!-- PlanReview body -->
    <template v-else-if="request.kind === 'PlanReview'">
      <PlanBody
        :content="planReview?.planContent || ''"
        @request-feedback="planFeedbackVisible = true"
        @go-to-terminal="onGoToTerminal"
      />
      <div v-if="planFeedbackVisible" class="plan-feedback-form">
        <textarea
          v-model="planFeedback"
          class="plan-feedback-textarea"
          :placeholder="t('bubble.planFeedbackPlaceholder')"
        ></textarea>
        <div class="plan-feedback-actions">
          <button class="btn btn-deny" @click="onExitFeedback">
            {{ t("bubble.back") }}
          </button>
          <button
            class="btn btn-allow"
            :disabled="!planFeedbackEnabled"
            @click="onRejectWithFeedback"
          >
            {{ t("bubble.submitFeedback") }}
          </button>
        </div>
      </div>
    </template>

    <!-- Footer — layout varies by kind.
         SideEffect primary action uses the tool-pill color (uma-pet
         convention) so the Allow button visually matches the tool
         pill in the header. PlanReview Approve stays green (single
         action, no tool context). -->
    <div class="footer">
      <!-- SideEffect: [Allow] [Deny] — primary action first, in tool-pill color -->
      <template v-if="request.kind === 'SideEffect'">
        <button
          class="btn btn-allow"
          :style="{ background: sideEffectPillHex }"
          :disabled="isSubmitting"
          @click="onAllowOnce"
        >
          {{ isSubmitting && !denyClicked ? "…" : t("bubble.allow") }}
        </button>
        <button
          class="btn btn-deny"
          :disabled="isSubmitting"
          @click="onDeny"
        >
          {{ isSubmitting && denyClicked ? "…" : t("bubble.deny") }}
        </button>
      </template>

      <!-- Elicitation: [Previous] [Next|Submit] with strict gate -->
      <template v-else-if="request.kind === 'Elicitation'">
        <button
          class="btn btn-deny"
          :disabled="elicitActiveIndex === 0 || isSubmitting"
          @click="onPrev"
        >
          {{ t("bubble.previousQuestion") }}
        </button>
        <button
          class="btn btn-allow"
          :disabled="!elicitSubmitEnabled || isSubmitting"
          @click="onNextOrSubmit"
        >
          {{
            elicitActiveIndex < elicitation!.questions.length - 1
              ? t("bubble.nextQuestion")
              : t("bubble.submitAnswer")
          }}
        </button>
      </template>

      <!-- PlanReview: single [Approve] button -->
      <template v-else-if="request.kind === 'PlanReview'">
        <button
          class="btn btn-allow"
          :disabled="isSubmitting"
          @click="onApprove"
          style="flex: 1"
        >
          {{ isSubmitting ? "…" : t("bubble.approve") }}
        </button>
      </template>
    </div>

    <!-- SideEffect suggestion list — below the footer (uma-pet
         convention: primary action first, "always allow" shortcuts
         visually separated below). -->
    <SuggestionList
      v-if="request.kind === 'SideEffect' && sideEffect?.permissionSuggestions?.length"
      :suggestions="sideEffect.permissionSuggestions"
      @pick="onSuggestionPick"
    />
  </div>
</template>