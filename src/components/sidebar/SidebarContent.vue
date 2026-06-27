<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-content"
    data-sidebar="content"
    :class="['sidebar-content', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-content {
  @apply gap-0 flex min-h-0 flex-1 flex-col overflow-auto;
}
.group[data-collapsible=icon] .sidebar-content {
  @apply overflow-hidden;
}
</style>
