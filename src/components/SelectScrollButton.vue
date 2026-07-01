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
      <div class="icon-lucide-chevron-up size-4" />
    </slot>
  </SelectScrollUpButton>
  <SelectScrollDownButton v-else :class="['select-scroll-button', props.class]">
    <slot>
      <div class="icon-lucide-chevron-down size-4" />
    </slot>
  </SelectScrollDownButton>
</template>
