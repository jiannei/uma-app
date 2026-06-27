<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { Primitive } from "reka-ui"

const props = withDefaults(defineProps<PrimitiveProps & {
  size?: "sm" | "md"
  isActive?: boolean
  class?: HTMLAttributes["class"]
}>(), {
  as: "a",
  size: "md",
})
</script>

<template>
  <Primitive
    data-slot="sidebar-menu-sub-button"
    data-sidebar="menu-sub-button"
    :as="as"
    :as-child="asChild"
    :data-size="size"
    :data-active="isActive || undefined"
    :class="['sidebar-menu-sub-button', props.class]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.sidebar-menu-sub-button {
  @apply text-[var(--sidebar-foreground)] ring-[var(--sidebar-ring)] hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)] active:bg-[var(--sidebar-accent)] active:text-sidebar-accent-[var(--foreground)] gap-2 rounded-md h-7 px-2 focus-visible:ring-2 flex w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50;
}
.sidebar-menu-sub-button[data-active="true"] {
  @apply bg-[var(--sidebar-accent)] text-sidebar-accent-[var(--foreground)];
}
.sidebar-menu-sub-button > svg {
  @apply size-4 shrink-0;
}
.sidebar-menu-sub-button > span:last-child {
  @apply truncate;
}
</style>
