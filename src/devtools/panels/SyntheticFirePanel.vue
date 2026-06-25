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
  <section class="panel">
    <h2>Fire Synthetic Event</h2>
    <div class="body">
      <form class="form" @submit.prevent="fire">
        <div class="field">
          <label>agent</label>
          <select v-model="agent">
            <option v-for="a in props.agents" :key="a.id" :value="a.id">
              {{ a.display_name }} ({{ a.id }})
            </option>
            <option v-if="props.agents.length === 0" value="claude-code">claude-code (no agents)</option>
          </select>
        </div>
        <div class="field">
          <label>session_id</label>
          <input v-model="sessionId" type="text" />
        </div>
        <div class="field">
          <label>event_type</label>
          <select v-model="eventType">
            <option v-for="e in CANONICAL_EVENTS" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>
        <div v-if="eventType === 'ToolCallStart' || eventType === 'ToolCallEnd' || eventType === 'UserPromptSubmit'" class="field">
          <label>tool_name</label>
          <input v-model="toolName" type="text" placeholder="e.g. Read, Bash, Task" />
        </div>
        <div v-if="eventType === 'ToolCallEnd'" class="field">
          <label>success</label>
          <select v-model="success">
            <option value="">(n/a)</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </div>
        <div v-if="eventType === 'ToolCallStart' || eventType === 'ToolCallEnd'" class="field">
          <label class="checkbox-label">
            <input v-model="subagent" type="checkbox" />
            subagent (ADR-0008 — drives juggling/groove/building)
          </label>
        </div>
        <button type="submit" class="fire">Fire</button>
      </form>

      <div class="perm-section">
        <h3>Fire Synthetic Permission</h3>
        <p class="perm-hint">
          Inserts a synthetic request into PendingStore + emits
          <code>permission-request</code> so the bubble renders without
          a real CC session. Click Allow / Deny in the bubble to
          complete the flow.
        </p>
        <div class="perm-buttons">
          <button
            v-for="k in PERM_KINDS"
            :key="k"
            class="perm-btn"
            :disabled="firing !== null"
            :data-firing="firing === k"
            @click="fireSyntheticPermission(k)"
          >
            {{ firing === k ? "firing…" : k }}
          </button>
        </div>
        <p v-if="lastFiredId" class="perm-status">
          ✓ last fired: <code>{{ lastFiredId }}</code>
        </p>
        <p v-if="lastError" class="perm-error">
          ✗ {{ lastError }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: #181825;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
h2 {
  font-size: 11px;
  font-weight: 600;
  color: #a6adc8;
  padding: 6px 10px;
  border-bottom: 1px solid #313244;
  background: #1e1e2e;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
h3 {
  font-size: 10px;
  color: #a6adc8;
  margin: 12px 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-size: 11px;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
label {
  font-size: 10px;
  color: #a6adc8;
  text-transform: uppercase;
}
select, input, textarea {
  background: #11111b;
  border: 1px solid #313244;
  color: #cdd6f4;
  border-radius: 3px;
  padding: 4px 6px;
  font-family: monospace;
  font-size: 11px;
}
select:focus, input:focus, textarea:focus {
  outline: none;
  border-color: #89b4fa;
}
.fire {
  background: #a6e3a1;
  color: #1e1e2e;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
}
.fire:hover { filter: brightness(0.9); }

.perm-section {
  border-top: 1px solid #313244;
  margin-top: 12px;
  padding-top: 4px;
}
.perm-hint {
  font-size: 10px;
  color: #a6adc8;
  line-height: 1.4;
  margin: 0 0 6px;
}
.perm-hint code {
  background: #313244;
  color: #fab387;
  padding: 0 3px;
  border-radius: 2px;
  font-size: 10px;
}
.perm-buttons {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.perm-btn {
  flex: 1;
  background: #89b4fa;
  color: #1e1e2e;
  border: none;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11px;
  font-weight: 600;
  font-family: monospace;
  cursor: pointer;
}
.perm-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.perm-btn:hover:not(:disabled) {
  filter: brightness(1.1);
}
.perm-btn[data-firing="true"] {
  background: #f9e2af;
}
.perm-status {
  font-size: 10px;
  color: #a6e3a1;
  margin: 6px 0 0;
}
.perm-status code {
  font-family: monospace;
  color: #fab387;
}
.perm-error {
  font-size: 10px;
  color: #f38ba8;
  margin: 6px 0 0;
}
</style>
