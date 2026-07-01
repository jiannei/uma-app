<script setup lang="ts">
import { SelectContent as RekaSelectContent, type SelectContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { useForwardProps } from "reka-ui"

const props = withDefaults(defineProps<SelectContentProps & {
  class?: HTMLAttributes["class"]
}>(), {
  position: "popper",
})
const forwarded = useForwardProps(props)
</script>

<template>
  <RekaSelectContent
    v-bind="forwarded"
    data-slot="select-content"
    :class="['select-content', props.class]"
  >
    <slot />
  </RekaSelectContent>
</template>
