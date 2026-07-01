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
