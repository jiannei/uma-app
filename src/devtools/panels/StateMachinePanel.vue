<script setup lang="ts">
// src/devtools/panels/StateMachinePanel.vue — Panel 1.
//
// Live view of the dev panel's local DisplayStateResolver: the current
// resolved display state + the flat `Record<SessionKey, SessionEntry>`
// tree. See docs/adr/0005-dev-tools.md D8 — this is a read-only
// inspector. Sessions are keyed by `${aid}:${sid}` (SessionKey).

import { computed } from "vue";
import type {
  MachineSnapshot as Snapshot,
  SessionEntry,
  SessionKey,
} from "../../pet/pet-machine-types";

const props = defineProps<{ snapshot: Snapshot }>();

function timeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}

function agentFromKey(key: SessionKey): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(0, idx) : key;
}

function sidFromKey(key: SessionKey): string {
  const idx = key.indexOf(":");
  return idx >= 0 ? key.slice(idx + 1) : key;
}

/** Group flat session entries by their agent prefix for display. */
const groupedByAgent = computed<Record<string, Array<[SessionKey, SessionEntry]>>>(() => {
  const out: Record<string, Array<[SessionKey, SessionEntry]>> = {};
  for (const [key, entry] of Object.entries(props.snapshot.sessions) as Array<
    [SessionKey, SessionEntry]
  >) {
    const aid = agentFromKey(key);
    if (!out[aid]) out[aid] = [];
    out[aid].push([key, entry]);
  }
  return out;
});

const agentIds = computed(() => Object.keys(groupedByAgent.value));
const sessionCount = computed(() => agentIds.value.length);
</script>

<template>
  <section class="panel">
    <h2>State Machine <span class="display">{{ props.snapshot.displayState }}</span></h2>
    <div class="body">
      <div v-if="sessionCount === 0" class="empty">
        No active sessions. Fire a synthetic SessionStart from Panel 5.
      </div>
      <div v-for="aid in agentIds" :key="aid" class="agent">
        <div class="agent-name">{{ aid }}</div>
        <div v-for="[key, entry] in groupedByAgent[aid]" :key="key" class="session">
          <span class="sid">{{ sidFromKey(key).slice(0, 12) }}</span>
          <span :class="['state', entry.state]">{{ entry.state }}</span>
          <span class="last">{{ entry.lastEvent }}</span>
          <span v-if="entry.toolName" class="tool">{{ entry.toolName }}</span>
          <span v-if="entry.subagentCount > 0" class="sub">+{{ entry.subagentCount }} sub</span>
          <span class="time">{{ timeShort(entry.timestamp) }}</span>
        </div>
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
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.display {
  color: #a6e3a1;
  font-family: monospace;
  font-size: 11px;
  text-transform: none;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-size: 11px;
}
.empty {
  color: #6c7086;
  font-style: italic;
}
.agent { margin-bottom: 8px; }
.agent-name {
  font-weight: 600;
  color: #cdd6f4;
  margin-bottom: 4px;
  font-family: monospace;
}
.session {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 3px 0 3px 8px;
  border-left: 2px solid #313244;
  font-family: monospace;
  font-size: 10px;
  color: #a6adc8;
  white-space: nowrap;
  overflow: hidden;
}
.sid { color: #6c7086; }
.state {
  font-weight: 600;
  padding: 0 4px;
  border-radius: 2px;
}
.state.error { color: #f38ba8; background: #3a1f2a; }
.state.working { color: #89b4fa; background: #1f2a3a; }
.state.thinking { color: #cba6f7; background: #2a1f3a; }
.state.notification { color: #fab387; background: #3a2a1f; }
.state.idle { color: #a6e3a1; background: #1f3a2a; }
.last { color: #cdd6f4; }
.tool { color: #f9e2af; }
.sub { color: #cba6f7; }
.time { color: #6c7086; margin-left: auto; }
</style>