<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    data-slot="sidebar-footer"
    data-sidebar="footer"
    :class="['sidebar-footer', props.class]"
  >
    <slot />
  </div>
</template>

<style scoped>
.sidebar-footer {
  @apply gap-2 p-2 flex flex-col;
}
</style>
