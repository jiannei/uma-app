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

<style scoped>
.select-content {
  @apply bg-[var(--popover)] text-[var(--popover-foreground)] min-w-36 rounded-lg shadow-md ring-1 ring-[var(--foreground)]/10 duration-100 relative z-50 max-h-[var(--reka-select-content-available-height)] origin-[var(--reka-select-content-transform-origin)] overflow-x-hidden overflow-y-auto;
}
</style>
