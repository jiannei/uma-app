<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed } from "vue"

const props = defineProps<{
  showIcon?: boolean
  class?: HTMLAttributes["class"]
}>()

const width = computed(() => {
  return `${Math.floor(Math.random() * 40) + 50}%`
})
</script>

<template>
  <div
    data-slot="sidebar-menu-skeleton"
    data-sidebar="menu-skeleton"
    :class="['sidebar-menu-skeleton', props.class]"
  >
    <div
      v-if="showIcon"
      data-slot="skeleton"
      data-sidebar="menu-skeleton-icon"
      class="size-4 rounded-md bg-[var(--muted)] animate-pulse"
    />

    <div
      data-slot="skeleton"
      data-sidebar="menu-skeleton-text"
      class="h-4 max-w-[var(--skeleton-width)] flex-1 bg-[var(--muted)] rounded-md animate-pulse"
      :style="{ '--skeleton-width': width }"
    />
  </div>
</template>
