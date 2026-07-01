<script setup lang="ts">
// src/bubble/ToolPillContent.vue — SideEffect expanded content.
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - request: SideEffectRequest
//
// Emits:
//   - "allow-once": user clicked Allow once
//   - "allow-with-suggestion": user clicked Allow with suggestion
//   - "deny": user clicked Deny

import { computed, onMounted, onUnmounted, nextTick } from "vue";
import type {
  PermissionUpdateEntry,
  SideEffectRequest,
} from "../types/permission";
import {
  permissionRegistry,
} from "../permission/registry";
import { suggestionLabel } from "./suggestion-label";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  request: SideEffectRequest;
}>();


const emit = defineEmits<{
  (e: "allow-once"): void;
  (e: "allow-with-suggestion", s: PermissionUpdateEntry): void;
  (e: "deny"): void;
}>();

// ADR-0018 Stage B (refined in PR #5): kind-aware preview formatting
// flows through `permissionRegistry.SideEffect.presentation.content(req)`.
// The SideEffectRender is computed internally by the registry — we
// never see the intermediate shape.
const preview = computed<string>(() =>
  permissionRegistry.SideEffect.presentation.content(props.request),
);

const suggestions = computed<PermissionUpdateEntry[]>(
  () => props.request.permissionSuggestions,
);

function allowOnce() {
  emit("allow-once");
}

function allowWithSuggestion(s: PermissionUpdateEntry) {
  emit("allow-with-suggestion", s);
}

function deny() {
  emit("deny");
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    deny();
  } else if (e.key >= "1" && e.key <= "9") {
    const idx = parseInt(e.key) - 1;
    const buttons = document.querySelectorAll<HTMLButtonElement>(".decision-button.suggestion");
    if (idx < buttons.length) {
      e.preventDefault();
      buttons[idx].click();
    }
  }
}

onMounted(async () => {
  await nextTick();
  const first = document.querySelector<HTMLButtonElement>(".decision-button.allow-once");
  first?.focus();
  window.addEventListener("keydown", onKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="tool-pill-content">
    <div class="command-section">
      <div class="section-label">COMMAND</div>
      <div class="command-block">
        <pre>{{ preview }}</pre>
      </div>
      <div class="cwd-hint" v-if="request.cwd">
        cwd: {{ request.cwd }}
      </div>
    </div>

    <div class="decision-section">
      <div class="section-label">ALLOW OPTIONS</div>

      <button class="decision-button allow-once" @click="allowOnce">
        <span class="key-hint">↵</span>
        <span class="decision-text">Allow once</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      </button>

      <button
        v-for="(s, i) in suggestions"
        :key="i"
        class="decision-button suggestion"
        @click="allowWithSuggestion(s)"
      >
        <span class="key-hint">{{ i + 1 }}</span>
        <span class="decision-text">{{ suggestionLabel(s, t) }}</span>
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="3 8 7 12 13 4" />
        </svg>
      </button>

      <button class="decision-button deny" @click="deny">
        <span class="key-hint">esc</span>
        <span class="decision-text">Deny</span>
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="4" y1="4" x2="12" y2="12" />
          <line x1="12" y1="4" x2="4" y2="12" />
        </svg>
      </button>
    </div>
  </div>
</template>
