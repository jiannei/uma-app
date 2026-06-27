<script setup lang="ts">
import { TooltipContent as RekaTooltipContent, type TooltipContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = withDefaults(defineProps<TooltipContentProps & {
  class?: HTMLAttributes["class"]
}>(), {
  sideOffset: 4,
})
</script>

<template>
  <RekaTooltipContent
    v-bind="props"
    data-slot="tooltip-content"
    :class="['tooltip-content', props.class]"
  >
    <slot />
  </RekaTooltipContent>
</template>

<style scoped>
.tooltip-content {
  @apply inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs bg-[var(--foreground)] text-[var(--background)] z-50 w-fit max-w-xs;
}
.tooltip-content:has([data-slot="kbd"]) {
  padding-right: 0.375rem;
}
</style>
