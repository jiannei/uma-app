<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <ul
    data-slot="sidebar-menu-sub"
    data-sidebar="menu-sub"
    :class="['sidebar-menu-sub', props.class]"
  >
    <slot />
  </ul>
</template>

<style scoped>
.sidebar-menu-sub {
  @apply mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-[var(--sidebar-border)] px-2.5 py-0.5;
}
</style>
