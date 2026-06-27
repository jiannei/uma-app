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
    data-slot="sidebar-group-action"
    data-sidebar="group-action"
    :as="as"
    :as-child="asChild"
    :class="['sidebar-group-action', props.class]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.sidebar-group-action {
  @apply text-[var(--sidebar-foreground)] ring-[var(--sidebar-ring)] hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)] absolute top-3.5 right-3 w-5 rounded-md p-0 focus-visible:ring-2 flex aspect-square items-center justify-center outline-hidden transition-transform;
}
.sidebar-group-action > svg {
  @apply size-4 shrink-0;
}
.group[data-collapsible="icon"] .sidebar-group-action {
  @apply hidden;
}
@media (min-width: 768px) {
  .sidebar-group-action::after {
    @apply hidden;
  }
}
</style>
