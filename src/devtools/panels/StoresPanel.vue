<script setup lang="ts">
// src/devtools/panels/StoresPanel.vue — Panel 4.
//
// Live view of the Rust PendingStore. Initial snapshot via
// `devtools_get_pending` on mount; subsequent updates via the
// `devtools-pending-changed` event. See docs/adr/0005-dev-tools.md
// D8.
//
// AlwaysAllowStore was removed in ADR-0011 — that section is gone.

import type {
  ElicitationRequest,
  PermissionRequest,
  PlanReviewRequest,
  SideEffectRequest,
} from "../../types/permission";

interface PendingEntryView {
  requestId: string;
  agentId: string;
  request: PermissionRequest;
}

const props = defineProps<{
  pending: PendingEntryView[];
}>();

// Kind badge color (Catppuccin Mocha).
function kindColor(kind: PermissionRequest["kind"]): string {
  switch (kind) {
    case "SideEffect":
      return "#89b4fa"; // blue
    case "Elicitation":
      return "#f9e2af"; // yellow
    case "PlanReview":
      return "#cba6f7"; // mauve
  }
}

// Per-kind detail string for the panel row.
function detail(req: PermissionRequest): string {
  switch (req.kind) {
    case "SideEffect": {
      const r = req as SideEffectRequest;
      const sug = r.permissionSuggestions.length;
      const sugSuffix = sug ? ` · ${sug} suggestion${sug === 1 ? "" : "s"}` : "";
      return `${r.toolName ?? "—"}${sugSuffix}`;
    }
    case "Elicitation": {
      const r = req as ElicitationRequest;
      return `${r.questions.length} question${r.questions.length === 1 ? "" : "s"}`;
    }
    case "PlanReview": {
      const r = req as PlanReviewRequest;
      const len = r.planContent?.length ?? 0;
      return `plan ${len > 0 ? `${len} chars` : "no content"}`;
    }
  }
}
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
        <div v-if="props.pending.length === 0" class="empty">
          No pending requests.
        </div>
        <div
          v-for="entry in props.pending"
          :key="entry.requestId"
          class="entry"
        >
          <span class="reqid">{{ entry.requestId }}</span>
          <span
            class="kind"
            :style="{ color: kindColor(entry.request.kind) }"
          >
            {{ entry.request.kind }}
          </span>
          <span class="agent">
            {{ entry.request.agentDisplayName || entry.agentId }}
          </span>
          <span class="detail">
            {{ detail(entry.request) }}
          </span>
          <span class="session">
            {{ entry.request.sessionId.slice(0, 8) }}
          </span>
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
  flex-wrap: wrap;
}
.reqid { color: #6c7086; }
.kind {
  font-weight: 600;
  text-transform: uppercase;
  font-size: 9px;
  letter-spacing: 0.5px;
}
.agent { color: #cba6f7; }
.detail { color: #a6e3a1; }
.session { color: #6c7086; }
</style>
