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
