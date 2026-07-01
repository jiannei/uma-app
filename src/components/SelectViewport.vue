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
