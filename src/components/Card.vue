<script setup lang="ts">
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div data-slot="card" :class="['card', props.class]">
    <slot />
  </div>
</template>

<style scoped>
.card {
  @apply ring-[var(--foreground)]/10 bg-[var(--card)] text-[var(--card-foreground)] gap-4 overflow-hidden rounded-xl py-4 text-sm ring-1 flex flex-col;
}
.card:has([data-slot="card-footer"]) {
  padding-bottom: 0;
}
.card > img:first-child {
  padding-top: 0;
  border-top-left-radius: var(--radius-xl, 12px);
  border-top-right-radius: var(--radius-xl, 12px);
}
.card > img:last-child {
  border-bottom-left-radius: var(--radius-xl, 12px);
  border-bottom-right-radius: var(--radius-xl, 12px);
}
</style>
