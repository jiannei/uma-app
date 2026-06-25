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
import { Badge } from "@/components/ui/badge";

interface PendingEntryView {
  requestId: string;
  agentId: string;
  request: PermissionRequest;
}

const props = defineProps<{
  pending: PendingEntryView[];
}>();

// Kind badge variant — maps to shadcn-vue Badge variants
function kindVariant(kind: PermissionRequest["kind"]): "default" | "secondary" | "outline" {
  return kind === "SideEffect" ? "default" : kind === "Elicitation" ? "secondary" : "outline";
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
  <section class="bg-card flex flex-col min-h-0 min-w-0">
    <h2 class="text-[11px] font-semibold text-muted-foreground px-2.5 py-1.5 border-b border-border bg-secondary/30 tracking-wider uppercase">
      Stores
    </h2>
    <div class="flex-1 overflow-auto p-2 text-[11px]">
      <div class="mb-3">
        <h3 class="text-[10px] text-muted-foreground mb-1 tracking-wider uppercase flex items-center gap-1">
          Pending
          <Badge variant="secondary" class="px-1.5 py-0 text-[10px] font-mono">
            {{ props.pending.length }}
          </Badge>
        </h3>
        <div v-if="props.pending.length === 0" class="text-muted-foreground italic py-0.5">
          No pending requests.
        </div>
        <div
          v-for="entry in props.pending"
          :key="entry.requestId"
          class="flex gap-1.5 py-0.5 font-mono text-[10px] text-foreground whitespace-nowrap overflow-hidden flex-wrap"
        >
          <span class="text-muted-foreground">{{ entry.requestId }}</span>
          <Badge :variant="kindVariant(entry.request.kind)" class="px-1 py-0 text-[9px] uppercase tracking-wider">
            {{ entry.request.kind }}
          </Badge>
          <span class="text-accent">
            {{ entry.request.agentDisplayName || entry.agentId }}
          </span>
          <span class="text-primary">
            {{ detail(entry.request) }}
          </span>
          <span class="text-muted-foreground">
            {{ entry.request.sessionId.slice(0, 8) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
