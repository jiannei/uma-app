<script setup lang="ts">
// src/devtools/panels/StoresPanel.vue — Panel 4.
//
// Live view of the Rust PendingStore and AlwaysAllowStore. Initial
// snapshot via `devtools_get_pending` + `devtools_get_always_allow`
// on mount; subsequent updates via `devtools-pending-changed` and
// `devtools-always-allow-changed` events. See docs/adr/0005-dev-tools.md
// D8.

import type { PermissionRequest } from "../../pet/pet-machine-types";

interface PendingEntryView {
  request_id: string;
  agent_id: string;
  request: PermissionRequest;
}
interface AlwaysAllowView {
  agent_id: string;
  session_id: string;
  tools: string[];
}

const props = defineProps<{
  pending: PendingEntryView[];
  alwaysAllow: AlwaysAllowView[];
}>();
</script>

<template>
  <section class="panel">
    <h2>Stores</h2>
    <div class="body">
      <div class="group">
        <h3>
          Pending
          <span class="count">{{ props.pending.length }}</span>
        </h3>
        <div v-if="props.pending.length === 0" class="empty">No pending requests.</div>
        <div v-for="entry in props.pending" :key="entry.request_id" class="entry">
          <span class="reqid">{{ entry.request_id }}</span>
          <span class="agent">{{ entry.request.agent_display_name || entry.agent_id }}</span>
          <span class="tool">{{ entry.request.tool_name || "—" }}</span>
          <span class="session">{{ (entry.request.session_id || "").slice(0, 8) }}</span>
        </div>
      </div>
      <div class="group">
        <h3>
          Always Allow
          <span class="count">{{ props.alwaysAllow.length }}</span>
        </h3>
        <div v-if="props.alwaysAllow.length === 0" class="empty">No always-allow entries.</div>
        <div v-for="entry in props.alwaysAllow" :key="entry.agent_id + entry.session_id" class="entry">
          <span class="agent">{{ entry.agent_id }}</span>
          <span class="session">{{ entry.session_id.slice(0, 8) }}</span>
          <span class="tools">{{ entry.tools.join(", ") }}</span>
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
}
.body {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-size: 11px;
}
.group { margin-bottom: 12px; }
h3 {
  font-size: 10px;
  color: #a6adc8;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.count {
  background: #313244;
  color: #cdd6f4;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 10px;
  font-family: monospace;
}
.empty {
  color: #6c7086;
  font-style: italic;
  padding: 2px 0;
}
.entry {
  display: flex;
  gap: 6px;
  padding: 2px 0;
  font-family: monospace;
  font-size: 10px;
  color: #cdd6f4;
  white-space: nowrap;
  overflow: hidden;
}
.reqid { color: #6c7086; }
.agent { color: #cba6f7; }
.tool { color: #f9e2af; }
.session { color: #6c7086; }
.tools { color: #a6e3a1; }
</style>
