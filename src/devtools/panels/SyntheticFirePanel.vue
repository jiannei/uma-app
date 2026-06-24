<script setup lang="ts">
// src/devtools/panels/SyntheticFirePanel.vue — Panel 5.
//
// Form for firing synthetic canonical `HookEvent`s at the local
// StateMachine instance (and the pet's, via the
// `devtools-synthetic-event` Tauri channel). See docs/adr/0005-dev-tools.md
// D6 — emits an envelope `{ event, synthetic: true, source: "devtools" }`.

import { ref } from "vue";
import type { HookEvent } from "../../pet/pet-machine-types";
import { CANONICAL_EVENTS } from "../../pet/pet-machine-constants";

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

async function fire() {
  const event: HookEvent = {
    session_id: sessionId.value,
    event_type: eventType.value,
    agent: agent.value,
  };
  if (eventType.value === "ToolCallStart" || eventType.value === "ToolCallEnd" ||
      eventType.value === "UserPromptSubmit") {
    if (toolName.value) event.tool_name = toolName.value;
  }
  if (eventType.value === "ToolCallEnd" && success.value !== "") {
    event.success = success.value === "true";
  }
  await props.fireSynthetic(event);
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
        <button type="submit" class="fire">Fire</button>
      </form>
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
</style>
