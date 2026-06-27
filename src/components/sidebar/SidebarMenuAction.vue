<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Primitive } from "reka-ui"

const props = withDefaults(defineProps<PrimitiveProps & {
  showOnHover?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  as: "button",
})
</script>

<template>
  <Primitive
    data-slot="sidebar-menu-action"
    data-sidebar="menu-action"
    :class="[
      'sidebar-menu-action',
      showOnHover && 'sidebar-menu-action-hover',
      props.class,
    ]"
    :as="as"
    :as-child="asChild"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.sidebar-menu-action {
  @apply text-[var(--sidebar-foreground)] ring-[var(--sidebar-ring)] hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)] absolute top-1.5 right-1 aspect-square w-5 rounded-md p-0 focus-visible:ring-2 flex items-center justify-center outline-hidden transition-transform;
}
.sidebar-menu-action > svg {
  @apply size-4 shrink-0;
}
.group[data-collapsible="icon"] .sidebar-menu-action {
  @apply hidden;
}
@media (min-width: 768px) {
  .sidebar-menu-action::after {
    @apply hidden;
  }
}
.sidebar-menu-action-hover {
  @apply md:opacity-0;
}
.group:hover .sidebar-menu-action-hover,
.group:focus-within .sidebar-menu-action-hover,
.sidebar-menu-action-hover[aria-expanded="true"] {
  @apply opacity-100;
}
</style>
