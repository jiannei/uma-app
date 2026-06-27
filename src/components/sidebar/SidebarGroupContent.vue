<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-group-content"
    data-sidebar="group-content"
    :class="['sidebar-group-content', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-group-content {
  @apply text-sm w-full;
}
</style>
