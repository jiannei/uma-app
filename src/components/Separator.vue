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

<style scoped>
.separator {
  @apply shrink-0 bg-[var(--border)];
}
.separator[data-orientation="horizontal"] {
  @apply h-px w-full;
}
.separator[data-orientation="vertical"] {
  @apply w-px self-stretch;
}
</style>
