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
          <div class="icon-lucide-chevron-down text-[var(--muted-foreground)] size-4 pointer-events-none" />
        </slot>
      </SelectIcon>
    </slot>
  </RekaSelectTrigger>
</template>
