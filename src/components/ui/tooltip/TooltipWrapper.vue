<script setup lang="ts">
// High-level Tooltip wrapper that accepts `text` prop.
// Composes shadcn-vue's TooltipRoot + TooltipTrigger + TooltipContent.

import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from ".";

defineProps<{
  text: string;
  side?: "top" | "right" | "bottom" | "left";
}>();
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <slot />
    </TooltipTrigger>
    <TooltipContent :side="side ?? 'top'">
      {{ text }}
    </TooltipContent>
  </Tooltip>
</template>
