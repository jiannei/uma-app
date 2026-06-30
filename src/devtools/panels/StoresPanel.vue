<script setup lang="ts">
// src/devtools/panels/StoresPanel.vue — Panel 4.
//
// Live view of the Rust PendingStore. Initial snapshot via
// `devtools_get_pending` on mount; subsequent updates via the
// `devtools-pending-changed` event. See docs/adr/0005-dev-tools.md
// D8.
//
// AlwaysAllowStore was removed in ADR-0011 — that section is gone.
//
// ADR-0018 Stage B: kind-dispatch (variant + detail) is sourced from
// `permissionRegistry[req.kind].presentation` (registry.ts). The
// per-kind switch that used to live here now lives in registry.ts and
// is unit-tested there.

import type { PermissionRequest } from "../../types/permission";
import { permissionRegistry, detail } from "../../permission/registry";
import Badge from "@/components/Badge.vue";

interface PendingEntryView {
  requestId: string;
  agentId: string;
  request: PermissionRequest;
}

const props = defineProps<{
  pending: PendingEntryView[];
}>();

// Map registry's presentation.badgeVariant ('warning' | 'info' |
// 'success') → Badge.vue's `variant` prop ('default' | 'secondary' |
// 'outline'). SideEffect uses the more prominent 'default' so a
// pending SideEffect stands out in the dev panel.
const BADGE_VARIANT_MAP = {
  warning: "default",
  info: "secondary",
  success: "outline",
} as const;

</script>

<template>
  <section class="bg-[var(--card)] flex flex-col min-h-0 min-w-0">
    <h2 class="text-[11px] font-semibold text-[var(--muted-foreground)] px-2.5 py-1.5 border-b border-[var(--border)] bg-[var(--secondary)]/30 tracking-wider uppercase">
      Stores
    </h2>
    <div class="flex-1 overflow-auto p-2 text-[11px]">
      <div class="mb-3">
        <h3 class="text-[10px] text-[var(--muted-foreground)] mb-1 tracking-wider uppercase flex items-center gap-1">
          Pending
          <Badge
            variant="secondary"
            class="px-1.5 py-0 text-[10px] font-mono"
          >
            {{ props.pending.length }}
          </Badge>
        </h3>
        <div v-if="props.pending.length === 0" class="text-[var(--muted-foreground)] italic py-0.5">
          No pending requests.
        </div>
        <div
          v-for="entry in props.pending"
          :key="entry.requestId"
          class="flex gap-1.5 py-0.5 font-mono text-[10px] text-[var(--foreground)] whitespace-nowrap overflow-hidden flex-wrap"
        >
          <span class="text-[var(--muted-foreground)]">{{ entry.requestId }}</span>
          <Badge
            :variant="BADGE_VARIANT_MAP[permissionRegistry[entry.request.kind].presentation.badgeVariant]"
            class="px-1 py-0 text-[9px] uppercase tracking-wider"
          >
            {{ entry.request.kind }}
          </Badge>
          <span class="text-[var(--accent)]">
            {{ entry.request.agentDisplayName || entry.agentId }}
          </span>
          <span class="text-[var(--primary)]">
            {{ detail(entry.request) }}
          </span>
          <span class="text-[var(--muted-foreground)]">
            {{ entry.request.sessionId.slice(0, 8) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>
