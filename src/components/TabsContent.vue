<script setup lang="ts">
import { TabsContent as RekaTabsContent, type TabsContentProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

const props = defineProps<TabsContentProps & {
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <RekaTabsContent
    :value="props.value"
    data-slot="tabs-content"
    :class="['tabs-content', props.class]"
  >
    <slot />
  </RekaTabsContent>
</template>
