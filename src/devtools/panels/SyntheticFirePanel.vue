<script setup lang="ts">
// src/devtools/panels/SyntheticFirePanel.vue — Panel 5.
//
// Form for firing synthetic canonical `HookEvent`s at the local
// StateMachine instance (and the robot's, via the
// `devtools-synthetic-event` Tauri channel). See docs/adr/0005-dev-tools.md
// D6 — emits an envelope `{ event, synthetic: true, source: "devtools" }`.
//
// Also exposes a second section: "Fire Synthetic Permission" — drives
// each of the 3 permission bubble renderers (SideEffect /
// Elicitation / PlanReview) without needing a real Claude Code
// session. The synthetic request is inserted into the Rust
// PendingStore and emitted on the `permission-request` Tauri event;
// the bubble renders it, the user clicks Allow / Deny, the
// decision flows through `respond_permission` and the entry is
// removed. No real CC hook call required.

import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import type { HookEvent } from "../../robot/display-state-types";
import { CANONICAL_EVENTS } from "../../robot/display-state-constants";
import Button from "@/components/Btn.vue";
import Input from "@/components/Input.vue";

interface AgentInfo {
  id: string;
  display_name: string;
}

const props = defineProps<{
  agents: AgentInfo[];
  fireSynthetic: (event: HookEvent) => Promise<void> | void;
}>();

const agent = ref(props.agents[0]?.id ?? "claude-code");
const sessionId = ref("test-session-1");
const eventType = ref<string>(CANONICAL_EVENTS[0]);
const toolName = ref("");
const success = ref<"" | "true" | "false">("");
const subagent = ref(false);

async function fire() {
  const event: HookEvent = {
    session_id: sessionId.value,
    event_type: eventType.value,
    agent: agent.value,
  };
  if (eventType.value === "ToolCallStart" || eventType.value === "ToolCallEnd" ||
      eventType.value === "UserPromptSubmit") {
    if (toolName.value) event.tool_name = toolName.value;
    // Drive the resolver's new subagent path (ADR-0008). Tool name
    // alone no longer matters — the flag does.
    if (eventType.value === "ToolCallStart" || eventType.value === "ToolCallEnd") {
      event.subagent = subagent.value;
    }
  }
  if (eventType.value === "ToolCallEnd" && success.value !== "") {
    event.success = success.value === "true";
  }
  await props.fireSynthetic(event);
}

// ── Synthetic permission (bubble) ─────────────────────────────

type PermKind = "SideEffect" | "Elicitation" | "PlanReview";
const PERM_KINDS: PermKind[] = ["SideEffect", "Elicitation", "PlanReview"];

const lastFiredId = ref<string | null>(null);
const lastError = ref<string | null>(null);
const firing = ref<PermKind | null>(null);

async function fireSyntheticPermission(kind: PermKind) {
  if (firing.value) return;
  firing.value = kind;
  lastError.value = null;
  try {
    const id = await invoke<string>("devtools_fire_synthetic_permission", {
      kind,
    });
    lastFiredId.value = id;
  } catch (err) {
    lastError.value = String(err);
  } finally {
    firing.value = null;
  }
}
</script>

<template>
  <section class="bg-[var(--card)] flex flex-col min-h-0 min-w-0">
    <h2 class="text-[11px] font-semibold text-[var(--muted-foreground)] px-2.5 py-1.5 border-b border-[var(--border)] bg-[var(--secondary)]/30 tracking-wider uppercase">
      Fire Synthetic Event
    </h2>
    <div class="flex-1 overflow-auto p-2 text-[11px]">
      <form class="flex flex-col gap-1.5" @submit.prevent="fire">
        <div class="flex flex-col gap-0.5">
          <label class="text-[10px] text-[var(--muted-foreground)] uppercase">agent</label>
          <select v-model="agent" class="dev-select">
            <option v-for="a in props.agents" :key="a.id" :value="a.id">
              {{ a.display_name }} ({{ a.id }})
            </option>
            <option v-if="props.agents.length === 0" value="claude-code">claude-code (no agents)</option>
          </select>
        </div>
        <div class="flex flex-col gap-0.5">
          <label class="text-[10px] text-[var(--muted-foreground)] uppercase">session_id</label>
          <Input v-model="sessionId" type="text" class="h-7 font-mono text-[11px]" />
        </div>
        <div class="flex flex-col gap-0.5">
          <label class="text-[10px] text-[var(--muted-foreground)] uppercase">event_type</label>
          <select v-model="eventType" class="dev-select">
            <option v-for="e in CANONICAL_EVENTS" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>
        <div v-if="eventType === 'ToolCallStart' || eventType === 'ToolCallEnd' || eventType === 'UserPromptSubmit'" class="flex flex-col gap-0.5">
          <label class="text-[10px] text-[var(--muted-foreground)] uppercase">tool_name</label>
          <Input v-model="toolName" type="text" placeholder="e.g. Read, Bash, Task" class="h-7 font-mono text-[11px]" />
        </div>
        <div v-if="eventType === 'ToolCallEnd'" class="flex flex-col gap-0.5">
          <label class="text-[10px] text-[var(--muted-foreground)] uppercase">success</label>
          <select v-model="success" class="dev-select">
            <option value="">(n/a)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div v-if="eventType === 'ToolCallStart' || eventType === 'ToolCallEnd'" class="flex items-center gap-1.5">
          <label class="flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)] uppercase">
            <input v-model="subagent" type="checkbox" class="cursor-pointer" />
            subagent (ADR-0008 — drives juggling/groove/building)
          </label>
        </div>
        <Button type="submit" class="mt-1">
          Fire
        </Button>
      </form>

      <div class="border-t border-[var(--border)] mt-3 pt-1">
        <h3 class="text-[10px] text-[var(--muted-foreground)] mt-3 mb-1 tracking-wider uppercase">
          Fire Synthetic Permission
        </h3>
        <p class="text-[10px] text-[var(--muted-foreground)] leading-snug mb-1.5">
          Inserts a synthetic request into PendingStore + emits
          <code class="bg-[var(--secondary)] text-[var(--primary)] px-1 rounded text-[10px]">permission-request</code>
          so the bubble renders without a real CC session. Click Allow / Deny in the bubble to
          complete the flow.
        </p>
        <div class="flex gap-1 mt-1">
          <Button
            v-for="k in PERM_KINDS"
            :key="k"
            variant="secondary"
            class="flex-1 font-mono"
            :disabled="firing !== null"
            @click="fireSyntheticPermission(k)"
          >
            {{ firing === k ? "firing…" : k }}
          </Button>
        </div>
        <p v-if="lastFiredId" class="text-[10px] text-[var(--primary)] mt-1.5">
          ✓ last fired: <code class="font-mono text-[var(--accent)]">{{ lastFiredId }}</code>
        </p>
        <p v-if="lastError" class="text-[10px] text-[var(--destructive)] mt-1.5">
          ✗ {{ lastError }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.dev-select {
  @apply bg-[var(--secondary)] border border-[var(--border)] text-[var(--foreground)] rounded px-1.5 py-1 font-mono text-[11px];
}
.dev-select:focus {
  @apply border-[var(--ring)] outline-none;
}
</style>
