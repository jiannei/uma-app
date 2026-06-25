// src/components/bubble/BubbleHeader.vue — shared header for all 3 bubble components.
//
// Each bubble has the same header structure: a colored icon badge + title +
// optional mono tag. This component extracts that pattern so the 3 bubble
// files (ElicitationBubble / PlanReviewBubble / SideEffectBubble) share one
// source of truth.
//
// Variant colors match shadcn-vue Button variants:
//   - 'accent'     → bg-accent / text-accent-foreground   (ElicitationBubble)
//   - 'secondary'  → bg-secondary / text-secondary-foreground (PlanReviewBubble)
//   - 'destructive' → bg-destructive / text-destructive-foreground (SideEffectBubble)
//
// The `icon` prop is a Lucide component (e.g. `HelpCircle`), rendered inside
// the badge. Color is applied via `currentColor` so the icon inherits the
// badge's text color automatically.

<script setup lang="ts">
import type { Component } from "vue";

type Variant = "accent" | "secondary" | "destructive";

const VARIANT_CLASSES: Record<Variant, string> = {
  accent: "bg-accent text-accent-foreground",
  secondary: "bg-secondary text-secondary-foreground border border-border",
  destructive: "bg-destructive text-destructive-foreground",
};

defineProps<{
  icon: Component;
  variant?: Variant;
  title: string;
  tag?: string;
}>();
</script>

<template>
  <header class="flex items-center gap-2">
    <span
      class="w-[22px] h-[22px] flex items-center justify-center text-[14px] rounded-full"
      :class="VARIANT_CLASSES[variant ?? 'secondary']"
    >
      <component :is="icon" class="h-3.5 w-3.5" />
    </span>
    <span class="font-semibold flex-1 text-foreground">
      {{ title }}
    </span>
    <span
      v-if="tag"
      class="font-mono text-[11px] bg-secondary text-accent py-0.5 px-2 rounded"
    >
      {{ tag }}
    </span>
  </header>
</template>
