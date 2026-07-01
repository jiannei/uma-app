<script setup lang="ts">
import { Separator as RekaSeparator, type SeparatorProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<SeparatorProps & {
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <RekaSeparator
    v-bind="props"
    data-slot="separator"
    :class="['separator', props.class]"
  />
</template>
