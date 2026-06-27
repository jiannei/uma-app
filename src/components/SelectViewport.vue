<script setup lang="ts">
import { SelectViewport as RekaSelectViewport } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <RekaSelectViewport :class="['select-viewport', props.class]">
    <slot />
  </RekaSelectViewport>
</template>

<style scoped>
.select-viewport {
  /* popper mode sizing via reka-ui CSS vars */
}
.select-viewport[data-position="popper"] {
  height: var(--reka-select-trigger-height);
  width: 100%;
  min-width: var(--reka-select-trigger-width);
}
</style>
