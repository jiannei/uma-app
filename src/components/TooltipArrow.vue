<script setup lang="ts">
import { TooltipArrow as RekaTooltipArrow } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <RekaTooltipArrow
    data-slot="tooltip-arrow"
    :class="['tooltip-arrow', props.class]"
  />
</template>

<style scoped>
.tooltip-arrow {
  @apply size-2.5 rotate-45 rounded-xs bg-[var(--foreground)] fill-[var(--foreground)] z-50;
  transform: translateY(calc(-50% - 2px));
}
</style>
