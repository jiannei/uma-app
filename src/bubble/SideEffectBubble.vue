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
import { Shield } from "@lucide/vue";
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
import { Button } from "@/components/ui/button";
import BubbleHeader from "@/components/bubble/BubbleHeader.vue";
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
    <div class="flex items-center justify-center h-screen text-muted-foreground text-[12px]">
      {{ bubbleText(lang, "waiting") }}
    </div>
  </template>

  <template v-else-if="elicitation">
    <ElicitationBubble :request="elicitation" />
  </template>

  <template v-else-if="planReview">
    <PlanReviewBubble :request="planReview" />
  </template>

  <template v-else-if="sideEffect">
    <div class="flex flex-col gap-2 p-3 text-[13px] select-none">
      <BubbleHeader
        :icon="Shield"
        variant="destructive"
        :title="`${sideEffect.agentDisplayName} wants permission`"
        :tag="sideEffect.toolName"
      />

      <div v-if="detailLine(sideEffect)" class="bg-muted text-muted-foreground font-mono text-[11px] p-2 rounded-md max-h-[60px] overflow-auto whitespace-pre-wrap break-words">
        {{ detailLine(sideEffect) }}
      </div>

      <div
        v-if="sideEffect.permissionSuggestions?.length"
        class="flex flex-col gap-1"
      >
        <Button
          v-for="(entry, i) in sideEffect.permissionSuggestions"
          :key="i"
          variant="outline"
          class="w-full justify-center"
          :disabled="sending"
          @click="pickSuggestion(sideEffect.requestId, entry)"
        >
          {{ suggestionLabel(entry, lang) }}
        </Button>
      </div>

      <div class="flex gap-1.5 mt-auto">
        <Button
          variant="default"
          class="flex-1"
          :disabled="sending"
          @click="allow(sideEffect.requestId)"
        >
          {{ bubbleText(lang, "allow") }}
        </Button>
        <Button
          variant="destructive"
          class="flex-1"
          :disabled="sending"
          @click="deny(sideEffect.requestId)"
        >
          {{ bubbleText(lang, "deny") }}
        </Button>
      </div>
    </div>
  </template>
</template>
