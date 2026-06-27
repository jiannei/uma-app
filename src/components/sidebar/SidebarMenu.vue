<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <ul
    data-slot="sidebar-menu"
    data-sidebar="menu"
    :class="['sidebar-menu', props.class]"
  >
    <slot />
  </ul>
</template>

<style scoped>
.sidebar-menu {
  @apply flex w-full min-w-0 flex-col gap-0.5;
}
</style>
