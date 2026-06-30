<script setup lang="ts">
// src/bubble/PanelShell.vue — Panel shell for Elicitation / PlanReview kind.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: ElicitationRequest | PlanReviewRequest
//
// Emits:
//   - "allow": user submitted (Elicitation: updatedInput, PlanReview: void)
//   - "deny": user rejected (message?)
//
// ADR-0018 Stage B PR3: the focus-key lookup used to be an inline kind
// switch (`.option-label` for Elicitation, `.footer-button.reject` for
// PlanReview). It now flows through
// `permissionRegistry[req.kind].presentation.focusKey`, with a local
// `focusKey → DOM selector` map that turns the semantic focusKey into
// the actual element to focus. The two template branches stay (they
// render different sub-components — AskPanelContent vs
// PlanPanelContent), but the per-kind casts are gone: the
// `elicitation` / `planReview` computeds narrow the union for the
// template.

import { computed, onMounted, onUnmounted, nextTick } from "vue";
import type {
  ElicitationRequest,
  PlanReviewRequest,
} from "../types/permission";
import { permissionRegistry } from "../permission/registry";
import PanelLayout from "./PanelLayout.vue";
import AskPanelContent from "./AskPanelContent.vue";
import PlanPanelContent from "./PlanPanelContent.vue";

const props = defineProps<{
  request: ElicitationRequest | PlanReviewRequest;
}>();

const emit = defineEmits<{
  (e: "allow", updatedInput?: unknown): void;
  (e: "deny", message?: string): void;
}>();

// Narrowed views for the template — replaces the per-kind `as` casts
// that used to live inline in the v-if/v-else-if branches.
const elicitation = computed<ElicitationRequest | null>(() =>
  props.request.kind === "Elicitation" ? props.request : null,
);
const planReview = computed<PlanReviewRequest | null>(() =>
  props.request.kind === "PlanReview" ? props.request : null,
);

// Semantic focusKey → DOM selector. The registry encodes the focusKey
// (Elicitation: "submit", PlanReview: "approve"); this map turns that
// semantic name into the actual selector the panel mounts with. Adding
// a new kind adds one entry here; the registry's focusKey is the
// single source of truth.
const FOCUS_SELECTOR = {
  submit: ".option-label",
  approve: ".footer-button.reject",
} as const;

// Type predicate narrows `props.request.kind` so the registry access
// below resolves to the Elicitation / PlanReview entry specifically
// (not the union with SideEffect's "allow-once").
function isElicitation(
  r: ElicitationRequest | PlanReviewRequest,
): r is ElicitationRequest {
  return r.kind === "Elicitation";
}

const focusKey = computed(() =>
  isElicitation(props.request)
    ? permissionRegistry.Elicitation.presentation.focusKey
    : permissionRegistry.PlanReview.presentation.focusKey,
);

function onAllow(updatedInput?: unknown) {
  emit("allow", updatedInput);
}

function onDeny(message?: string) {
  emit("deny", message);
}

function onKeydown(e: KeyboardEvent) {
  // Skip if user is typing in the textarea / a contentEditable surface
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;

  if (e.key === "Escape") {
    e.preventDefault();
    onDeny();
  } else if (e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key) - 1;
    const buttons = document.querySelectorAll<HTMLButtonElement>(".option-label");
    if (idx < buttons.length) {
      e.preventDefault();
      buttons[idx].click();
    }
  }
}

onMounted(async () => {
  await nextTick();
  const selector =
    FOCUS_SELECTOR[focusKey.value as keyof typeof FOCUS_SELECTOR];
  document.querySelector<HTMLElement>(selector)?.focus();
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <PanelLayout
    v-if="elicitation"
    icon="❓"
    title="Question"
    :kind-color="'var(--icon-chip-elicitation)'"
  >
    <template #header-right>
      <!-- Progress dots for Elicitation (provided by AskPanelContent) -->
    </template>

    <template #body>
      <AskPanelContent
        :request="elicitation"
        @submit="onAllow"
        @deny="onDeny"
      />
    </template>

    <template #footer>
      <!-- Footer buttons provided by AskPanelContent -->
    </template>
  </PanelLayout>

  <PanelLayout
    v-else-if="planReview"
    icon="📋"
    title="Plan"
    :kind-color="'var(--icon-chip-planreview)'"
  >
    <template #header-right>
      <!-- Read % for PlanReview (provided by PlanPanelContent) -->
    </template>

    <template #body>
      <PlanPanelContent
        :request="planReview"
        @approve="onAllow"
        @reject="onDeny"
      />
    </template>

    <template #footer>
      <!-- Footer buttons provided by PlanPanelContent -->
    </template>
  </PanelLayout>
</template>