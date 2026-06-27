<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <main
    data-slot="sidebar-inset"
    :class="['sidebar-inset', props.class]"
  >
    <slot />
  </main>
</template>

<style scoped>
.sidebar-inset {
  @apply bg-[var(--background)] relative flex w-full flex-1 flex-col;
}
</style>
