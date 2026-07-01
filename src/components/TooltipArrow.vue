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
