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
