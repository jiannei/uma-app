<script setup lang="ts">
import { Label as RekaLabel, type LabelProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<LabelProps & {
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <RekaLabel
    :class="['label', props.class]"
    v-bind="$attrs"
  >
    <slot />
  </RekaLabel>
</template>
