<script setup lang="ts">
import { SelectItem as RekaSelectItem, SelectItemText } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<{
  value: string
  class?: HTMLAttributes["class"]
  disabled?: boolean
}>()
</script>

<template>
  <RekaSelectItem
    :value="value"
    :disabled="disabled"
    data-slot="select-item"
    :class="['select-item', props.class]"
  >
    <slot>
      <SelectItemText />
    </slot>
  </RekaSelectItem>
</template>

<style scoped>
.select-item {
  @apply gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm relative flex w-full cursor-default items-center outline-hidden select-none;
}
.select-item:focus {
  @apply bg-[var(--accent)] text-[var(--accent-foreground)];
}
.select-item[data-disabled] {
  @apply pointer-events-none opacity-50;
}
</style>
