<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-header"
    data-sidebar="header"
    :class="['sidebar-header', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-header {
  @apply gap-2 p-2 flex flex-col;
}
</style>
