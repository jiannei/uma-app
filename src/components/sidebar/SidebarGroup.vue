<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-group"
    data-sidebar="group"
    :class="['sidebar-group', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-group {
  @apply p-2 relative flex w-full min-w-0 flex-col;
}
</style>
