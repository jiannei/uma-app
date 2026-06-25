<script setup lang="ts">
// src/components/ui/tooltip/Tooltip.vue — Reka UI TooltipRoot
// wrapper with Catppuccin Mocha styling. Wraps any trigger
// element; shows a small floating label on hover / focus.
//
// Usage:
//   <Tooltip text="How this works">
//     <button>...</button>
//   </Tooltip>

import { TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent, TooltipArrow } from "reka-ui";

defineProps<{
  text: string;
  /** Side to render relative to the trigger. */
  side?: "top" | "right" | "bottom" | "left";
}>();
</script>

<template>
  <TooltipRoot :delay-duration="200">
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        :side="side ?? 'top'"
        :side-offset="4"
        class="TooltipContent"
      >
        <TooltipArrow class="TooltipArrow" :width="8" :height="4" />
        {{ text }}
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>

<style scoped>
.TooltipContent {
  background: #313244;
  color: #cdd6f4;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #45475a;
  user-select: none;
  z-index: 10000;
  max-width: 240px;
}

.TooltipArrow {
  fill: #313244;
}
</style>