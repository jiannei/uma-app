<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-menu-badge"
    data-sidebar="menu-badge"
    :class="['sidebar-menu-badge', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-menu-badge {
  @apply text-[var(--sidebar-foreground)] pointer-events-none absolute right-1 h-5 min-w-5 rounded-md px-1 text-xs font-medium flex items-center justify-center tabular-nums select-none;
}
</style>
