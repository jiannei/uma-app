<script setup lang="ts">
import { SwitchRoot, SwitchThumb, type SwitchRootEmits, type SwitchRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { useForwardPropsEmits } from "reka-ui"

const props = defineProps<SwitchRootProps & {
  class?: HTMLAttributes["class"]
}>()
const emits = defineEmits<SwitchRootEmits>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <SwitchRoot
    v-bind="forwarded"
    data-slot="switch"
    :class="['switch', props.class]"
  >
    <SwitchThumb data-slot="switch-thumb" class="switch-thumb" />
  </SwitchRoot>
</template>
