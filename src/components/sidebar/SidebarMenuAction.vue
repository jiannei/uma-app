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
