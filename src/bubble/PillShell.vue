<script setup lang="ts">
// src/bubble/PillShell.vue — Pill shell for SideEffect kind.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: SideEffectRequest
//
// Emits:
//   - "allow": user clicked Allow once / Allow with suggestion
//   - "deny": user clicked Deny
//
// Internal state:
//   - isExpanded: ref<boolean> (compact ↔ expanded)

import { ref, onMounted, onUnmounted, nextTick, computed } from "vue";
import type { SideEffectRequest } from "../types/permission";
import {
  permissionRegistry,
} from "../permission/registry";
import PillLayout from "./PillLayout.vue";
import ToolPillContent from "./ToolPillContent.vue";

const props = defineProps<{
  request: SideEffectRequest;
}>();

const emit = defineEmits<{
  (e: "allow", updatedPermissions?: import("../types/permission").PermissionUpdateEntry[]): void;
  (e: "deny", message?: string): void;
  (e: "expand"): void;
  (e: "collapse"): void;
}>();

const isExpanded = ref(false);
const isTransitioning = ref(false);
const allowButtonRef = ref<HTMLButtonElement | null>(null);

// ADR-0018 Stage B: the kind-aware rendering (Bash command / Edit-Write-Read
// file path / json fallback) used to be an inline switch on
// classifySideEffect's result. It now goes through
// registry.presentation.{summary,title,content}(req) so the kind-of-kind
// logic lives in registry.ts. The registry computes the
// SideEffectRender internally — we never see the intermediate shape.
const summary = computed<string>(() =>
  permissionRegistry.SideEffect.presentation.summary(props.request),
);
const expandedTitle = computed<string>(() =>
  permissionRegistry.SideEffect.presentation.title(props.request),
);

function onExpand() {
  isExpanded.value = true;
  emit("expand");
}

function onCollapse() {
  isExpanded.value = false;
  emit("collapse");
}

function onAllowOnce() {
  emit("allow");
}

function onAllowWithSuggestion(s: import("../types/permission").PermissionUpdateEntry) {
  emit("allow", [s]);
}

function onDeny() {
  emit("deny");
}

function onKeydown(e: KeyboardEvent) {
  if (isTransitioning.value) return;

  if (e.key === "Enter") {
    if (document.activeElement === allowButtonRef.value) {
      onAllowOnce();
    } else if (document.activeElement?.classList.contains("middle-button")) {
      onExpand();
    }
  } else if (e.key === "Escape") {
    onDeny();
  } else if (e.key === "ArrowDown") {
    if (document.activeElement?.classList.contains("middle-button")) {
      onExpand();
    }
  }
}

onMounted(async () => {
  await nextTick();
  allowButtonRef.value?.focus();
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <PillLayout
    icon="🔧"
    :summary="summary"
    :is-expanded="isExpanded"
    :kind-color="'var(--icon-chip-sideeffect)'"
    dot-color="#f59e0b"
    @expand="onExpand"
    @collapse="onCollapse"
  >
    <template #actions-compact>
      <button
        ref="allowButtonRef"
        class="action-button allow"
        @click="onAllowOnce"
        title="Allow once (Enter)"
        aria-label="Allow once"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      </button>
      <button
        class="action-button deny"
        @click="onDeny"
        title="Deny (Esc)"
        aria-label="Deny"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </template>

    <template #expanded-title>{{ expandedTitle }}</template>

    <template #expanded>
      <ToolPillContent
        :request="props.request"
        @allow-once="onAllowOnce"
        @allow-with-suggestion="onAllowWithSuggestion"
        @deny="onDeny"
      />
    </template>
  </PillLayout>
</template>

<style scoped>
.action-button {
  height: 30px;
  width: 30px;
  padding: 0;
  border-radius: 15px;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-button.allow {
  background: #22c55e;
  color: #052e10;
}

.action-button.deny {
  background: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
}
</style>
