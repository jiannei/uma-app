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
} from "../../robot/display-state-types";
import { Badge } from "@/components/ui/badge";
import type { BadgeVariants } from "@/components/ui/badge";

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

// State → Badge variant mapping for color-coded session states.
const stateVariant: Record<string, BadgeVariants["variant"]> = {
  error: "destructive",
  working: "default",
  thinking: "secondary",
  notification: "outline",
  idle: "secondary",
};

function stateVariantFor(state: string): BadgeVariants["variant"] {
  return stateVariant[state] ?? "outline";
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
  <section class="bg-card flex flex-col min-h-0 min-w-0">
    <h2 class="text-[11px] font-semibold text-muted-foreground px-2.5 py-1.5 border-b border-border bg-secondary/30 tracking-wider uppercase flex justify-between items-center">
      <span>State Machine</span>
      <span class="text-primary font-mono text-[11px] normal-case tracking-normal">
        {{ props.snapshot.displayState }}
      </span>
    </h2>
    <div class="flex-1 overflow-auto p-2 text-[11px]">
      <div v-if="sessionCount === 0" class="text-muted-foreground italic">
        No active sessions. Fire a synthetic SessionStart from Panel 5.
      </div>
      <div v-for="aid in agentIds" :key="aid" class="mb-2">
        <div class="font-semibold text-foreground mb-1 font-mono">{{ aid }}</div>
        <div v-for="[key, entry] in groupedByAgent[aid]" :key="key" class="flex gap-1.5 items-center py-0.5 pl-2 border-l-2 border-border font-mono text-[10px] text-muted-foreground whitespace-nowrap overflow-hidden">
          <span class="text-muted-foreground">{{ sidFromKey(key).slice(0, 12) }}</span>
          <Badge :variant="stateVariantFor(entry.state)" class="px-1 py-0 text-[9px] font-semibold">
            {{ entry.state }}
          </Badge>
          <span class="text-foreground">{{ entry.lastEvent }}</span>
          <span v-if="entry.toolName" class="text-accent">{{ entry.toolName }}</span>
          <span v-if="entry.subagentCount > 0" class="text-primary">+{{ entry.subagentCount }} sub</span>
          <span class="text-muted-foreground ml-auto">{{ timeShort(entry.timestamp) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
