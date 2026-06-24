<script setup lang="ts">
// src/devtools/panels/EventLogPanel.vue — Panel 2.
//
// 1000-entry ring buffer of every event reaching the dev panel
// (both real `agent-hook-event` and synthetic `devtools-synthetic-event`).
// Synthetic events are marked with a [SYNTH] badge so the user can
// distinguish the two streams at a glance.

interface EventLogEntry {
  timestamp: number;
  source: "http" | "devtools";
  synthetic: boolean;
  agent: string;
  session_id: string;
  event_type: string;
  payload: unknown;
}

const props = defineProps<{ entries: EventLogEntry[] }>();

function timeShort(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour12: false }) +
    "." + String(d.getMilliseconds()).padStart(3, "0");
}
function payloadPreview(p: unknown): string {
  const s = JSON.stringify(p);
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
</script>

<template>
  <section class="panel">
    <h2>Event Log <span class="count">{{ props.entries.length }}</span></h2>
    <div class="body">
      <div v-if="props.entries.length === 0" class="empty">
        No events yet.
      </div>
      <div v-for="(entry, i) in [...props.entries].reverse()" :key="i" class="row">
        <span class="time">{{ timeShort(entry.timestamp) }}</span>
        <span :class="['badge', entry.synthetic ? 'synth' : 'real']">
          {{ entry.synthetic ? "[SYNTH]" : "[REAL]" }}
        </span>
        <span class="type">{{ entry.event_type }}</span>
        <span class="agent">{{ entry.agent || "—" }}</span>
        <span class="sid">{{ (entry.session_id || "").slice(0, 8) }}</span>
        <span class="payload">{{ payloadPreview(entry.payload) }}</span>
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
.count {
  background: #313244;
  color: #cdd6f4;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  font-family: monospace;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 4px 10px;
  font-size: 10px;
  font-family: monospace;
}
.empty {
  color: #6c7086;
  font-style: italic;
  padding: 8px 0;
}
.row {
  display: flex;
  gap: 6px;
  padding: 2px 0;
  border-bottom: 1px solid #1e1e2e;
  color: #cdd6f4;
  white-space: nowrap;
  overflow: hidden;
}
.time { color: #6c7086; }
.badge {
  font-weight: 600;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
}
.badge.synth { color: #fab387; background: #3a2a1f; }
.badge.real { color: #89b4fa; background: #1f2a3a; }
.type { color: #a6e3a1; }
.agent { color: #cba6f7; }
.sid { color: #6c7086; }
.payload {
  color: #6c7086;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
</style>
