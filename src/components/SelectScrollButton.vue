<script setup lang="ts">
import { SelectScrollUpButton, SelectScrollDownButton } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  direction?: "up" | "down"
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <SelectScrollUpButton v-if="direction === 'up'" :class="['select-scroll-button', props.class]">
    <slot>
      <div class="i-lucide-chevron-up size-4" />
    </slot>
  </SelectScrollUpButton>
  <SelectScrollDownButton v-else :class="['select-scroll-button', props.class]">
    <slot>
      <div class="i-lucide-chevron-down size-4" />
    </slot>
  </SelectScrollDownButton>
</template>

<style scoped>
.select-scroll-button {
  @apply flex cursor-default items-center justify-center py-1;
}
</style>
