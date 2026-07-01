<script setup lang="ts">
import { TabsRoot as RekaTabsRoot, type TabsRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<TabsRootProps & {
  class?: HTMLAttributes["class"]
}>()
const emits = defineEmits<{
  (e: "update:modelValue", payload: string): void
}>()
</script>

<template>
  <RekaTabsRoot
    :model-value="props.modelValue as string"
    :default-value="props.defaultValue as string | undefined"
    :orientation="props.orientation"
    :dir="props.dir"
    :activation-mode="props.activationMode"
    :unmount-on-hide="props.unmountOnHide"
    data-slot="tabs"
    :class="['tabs', props.class]"
    @update:model-value="emits('update:modelValue', $event as string)"
  >
    <slot />
  </RekaTabsRoot>
</template>
