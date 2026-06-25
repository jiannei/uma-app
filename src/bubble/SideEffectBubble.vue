<script setup lang="ts">
// src/bubble/SideEffectBubble.vue — top-level permission bubble
// dispatcher. Listens for the `permission-request` Tauri event and
// routes by kind:
//   - SideEffect → inline render (tool pill + tool_input summary
//     + permission_suggestions + Allow / Deny)
//   - Elicitation → ElicitationBubble (multi-question form)
//   - PlanReview → PlanReviewBubble (plan content + feedback)
//
// Click handlers invoke the canonical `respond_permission` Tauri
// command, which forwards the `PermissionDecision` to the HTTP
// server's `handle_permission` via the oneshot channel.

import { ref, computed, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  PermissionDecision,
  PermissionRequest,
  PermissionUpdateEntry,
  SideEffectRequest,
} from "./types";
import { bubbleText } from "./strings";
import { formatDetail } from "./format-detail";
import { suggestionLabel } from "./suggestion-label";
import { useBubbleLang } from "./lang";
import ElicitationBubble from "./ElicitationBubble.vue";
import PlanReviewBubble from "./PlanReviewBubble.vue";

const lang = useBubbleLang(); // reactive — updated by set_language

const current = ref<PermissionRequest | null>(null);
const sending = ref(false);
let unlisten: UnlistenFn | undefined;

// Computed projections for each kind. Vue's template type checker
// doesn't narrow discriminated unions across v-if/v-else-if chains,
// so we resolve the variant explicitly in the script side and let
// the template consume the typed computed. `null` when the variant
// doesn't match.
const sideEffect = computed<SideEffectRequest | null>(() => {
  const c = current.value;
  return c && c.kind === "SideEffect" ? c : null;
});
const elicitation = computed(() => {
  const c = current.value;
  return c && c.kind === "Elicitation" ? c : null;
});
const planReview = computed(() => {
  const c = current.value;
  return c && c.kind === "PlanReview" ? c : null;
});

onMounted(async () => {
  try {
    unlisten = await listen<PermissionRequest>("permission-request", (e) => {
      current.value = e.payload;
      sending.value = false;
    });
  } catch (err) {
    console.error("[bubble] listen() failed:", err);
  }
});

onUnmounted(() => {
  unlisten?.();
});

async function decide(decision: PermissionDecision) {
  if (sending.value) return;
  sending.value = true;
  try {
    await invoke("respond_permission", { decision });
  } catch (err) {
    console.error("[bubble] respond_permission failed:", err);
    sending.value = false;
  }
}

function allow(requestId: string) {
  return decide({ requestId, behavior: "allow" });
}

function deny(requestId: string) {
  return decide({ requestId, behavior: "deny" });
}

function pickSuggestion(
  requestId: string,
  entry: PermissionUpdateEntry,
) {
  return decide({
    requestId,
    behavior: "allow",
    updatedPermissions: [entry],
  });
}

// Per-tool tool_input one-liner.
function detailLine(s: SideEffectRequest): string {
  return formatDetail(s.toolName, s.toolInput);
}
</script>

<template>
  <!--
    Use a v-if / v-else-if / v-else-if / v-else-if chain on a single
    <template> wrapper. Mixing `v-if` + multiple sibling `v-else-if`
    on independent <div> roots works in Vue 3 but the template
    compiler occasionally evaluates inner expressions of branches
    that don't end up selected, which can throw on nullish
    access. Wrapping in a single <template> makes the chain
    unambiguous to the compiler.
  -->
  <template v-if="!current">
    <div class="empty">{{ bubbleText(lang, "waiting") }}</div>
  </template>

  <template v-else-if="elicitation">
    <ElicitationBubble :request="elicitation" />
  </template>

  <template v-else-if="planReview">
    <PlanReviewBubble :request="planReview" />
  </template>

  <template v-else-if="sideEffect">
    <div class="kind sideeffect">
      <header>
        <span class="icon">🔐</span>
        <span class="title">
          {{ sideEffect.agentDisplayName }} wants permission
        </span>
        <span v-if="sideEffect.toolName" class="tool-pill">
          {{ sideEffect.toolName }}
        </span>
      </header>

      <div v-if="detailLine(sideEffect)" class="details">
        {{ detailLine(sideEffect) }}
      </div>

      <div
        v-if="sideEffect.permissionSuggestions?.length"
        class="suggestions"
      >
        <button
          v-for="(entry, i) in sideEffect.permissionSuggestions"
          :key="i"
          class="btn suggestion"
          :disabled="sending"
          @click="pickSuggestion(sideEffect.requestId, entry)"
        >
          {{ suggestionLabel(entry, lang) }}
        </button>
      </div>

      <div class="actions">
        <button
          class="btn allow"
          :disabled="sending"
          @click="allow(sideEffect.requestId)"
        >
          {{ bubbleText(lang, "allow") }}
        </button>
        <button
          class="btn deny"
          :disabled="sending"
          @click="deny(sideEffect.requestId)"
        >
          {{ bubbleText(lang, "deny") }}
        </button>
      </div>
    </div>
  </template>
</template>

<style scoped>
* { margin: 0; padding: 0; box-sizing: border-box; }

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #6c7086;
  font-size: 12px;
}

.kind {
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  background: #f38ba8;
  border-radius: 50%;
}

.title {
  font-weight: 600;
  flex: 1;
  color: #cdd6f4;
}

.tool-pill {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  background: #313244;
  color: #fab387;
  padding: 2px 8px;
  border-radius: 4px;
}

.details {
  background: #1e1e2e;
  color: #a6adc8;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  padding: 8px 10px;
  border-radius: 6px;
  max-height: 60px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.suggestions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.placeholder-note {
  font-size: 11px;
  color: #a6adc8;
  line-height: 1.5;
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

.btn.allow { background: #a6e3a1; color: #1e1e2e; }
.btn.deny { background: #f38ba8; color: #1e1e2e; }
.btn.suggestion { background: #89b4fa; color: #1e1e2e; }
</style>