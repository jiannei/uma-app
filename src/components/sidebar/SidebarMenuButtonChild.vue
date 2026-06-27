<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { Primitive } from "reka-ui"

export type SidebarMenuButtonVariant = "default" | "outline"
export type SidebarMenuButtonSize = "default" | "sm" | "lg"

export interface SidebarMenuButtonProps extends PrimitiveProps {
  variant?: SidebarMenuButtonVariant
  size?: SidebarMenuButtonSize
  isActive?: boolean
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<SidebarMenuButtonProps>(), {
  as: "button",
  variant: "default",
  size: "default",
})

const classes = computed(() => [
  'sidebar-menu-button',
  `sidebar-menu-button-${props.variant}`,
  `sidebar-menu-button-size-${props.size}`,
  props.class,
])
</script>

<template>
  <Primitive
    data-slot="sidebar-menu-button"
    data-sidebar="menu-button"
    :data-size="size"
    :data-active="isActive || undefined"
    :class="classes"
    :as="as"
    :as-child="asChild"
    v-bind="$attrs"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.sidebar-menu-button {
  @apply ring-[var(--sidebar-ring)] hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)] active:bg-[var(--sidebar-accent)] active:text-sidebar-accent-[var(--foreground)] gap-2 rounded-md p-2 text-left text-sm transition-[width,height,padding] focus-visible:ring-2 flex w-full items-center overflow-hidden outline-hidden disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50;
}
.sidebar-menu-button[data-active="true"] {
  @apply font-medium;
}
.sidebar-menu-button > svg,
.sidebar-menu-button > span:last-child {
  @apply size-4 shrink-0;
}
.sidebar-menu-button > span:last-child {
  @apply truncate;
}
.group[data-collapsible="icon"] .sidebar-menu-button {
  @apply size-8 p-2;
}
.sidebar-menu-button-default {
  @apply hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)];
}
.sidebar-menu-button-outline {
  @apply bg-[var(--background)] hover:bg-[var(--sidebar-accent)] hover:text-sidebar-accent-[var(--foreground)];
  box-shadow: 0 0 0 1px var(--sidebar-border);
}
.sidebar-menu-button-outline:hover {
  box-shadow: 0 0 0 1px var(--sidebar-accent);
}
.sidebar-menu-button-size-default {
  @apply h-8 text-sm;
}
.sidebar-menu-button-size-sm {
  @apply h-7 text-xs;
}
.sidebar-menu-button-size-lg {
  @apply h-12 text-sm;
}
.group[data-collapsible="icon"] .sidebar-menu-button-size-lg {
  @apply p-0;
}
</style>
