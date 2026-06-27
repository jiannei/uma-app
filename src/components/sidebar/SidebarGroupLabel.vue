<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Primitive } from "reka-ui"

const props = defineProps<PrimitiveProps & {
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Primitive
    data-slot="sidebar-group-label"
    data-sidebar="group-label"
    :as="as"
    :as-child="asChild"
    :class="['sidebar-group-label', props.class]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.sidebar-group-label {
  @apply text-[var(--sidebar-foreground)]/70 ring-[var(--sidebar-ring)] h-8 rounded-md px-2 text-xs font-medium transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 flex shrink-0 items-center outline-hidden;
}
.sidebar-group-label > svg {
  @apply size-4 shrink-0;
}
.group[data-collapsible="icon"] .sidebar-group-label {
  @apply -mt-8 opacity-0;
}
</style>
