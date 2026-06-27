<script setup lang="ts">
import { SelectTrigger as RekaSelectTrigger, SelectValue, SelectIcon, type SelectTriggerProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { useForwardProps } from "reka-ui"

const props = defineProps<SelectTriggerProps & {
  class?: HTMLAttributes["class"]
}>()
const forwarded = useForwardProps(props)
</script>

<template>
  <RekaSelectTrigger
    v-bind="forwarded"
    data-slot="select-trigger"
    :class="['select-trigger', props.class]"
  >
    <slot>
      <SelectValue />
      <SelectIcon as-child>
        <slot name="icon">
          <div class="i-lucide-chevron-down text-[var(--muted-foreground)] size-4 pointer-events-none" />
        </slot>
      </SelectIcon>
    </slot>
  </RekaSelectTrigger>
</template>

<style scoped>
.select-trigger {
  @apply border-[var(--input)] gap-1.5 rounded-lg border bg-transparent py-2 pr-2 pl-2.5 text-sm transition-colors select-none flex w-fit items-center justify-between whitespace-nowrap outline-none;
}
.select-trigger[data-placeholder] {
  @apply text-[var(--muted-foreground)];
}
.select-trigger:focus-visible {
  @apply border-[var(--ring)] ring-[var(--ring)]/50 ring-3;
}
.select-trigger[data-size="default"] {
  @apply h-8;
}
.select-trigger[data-size="sm"] {
  @apply h-7 rounded-[min(var(--radius-md),10px)];
}
.select-trigger:disabled {
  @apply cursor-not-allowed opacity-50;
}
.dark .select-trigger {
  @apply bg-[var(--input)]/30;
}
.dark .select-trigger:hover {
  @apply bg-[var(--input)]/50;
}
</style>
