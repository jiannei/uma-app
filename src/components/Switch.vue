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

<style scoped>
.switch {
  @apply relative inline-flex shrink-0 items-center rounded-full border border-transparent transition-all outline-none w-8 h-[18.4px];
}
.switch[data-checked] {
  @apply bg-[var(--primary)];
}
.switch[data-unchecked] {
  @apply bg-[var(--input)];
}
.switch:focus-visible {
  @apply border-[var(--ring)] ring-[var(--ring)]/50 ring-3;
}
.switch[data-disabled] {
  @apply cursor-not-allowed opacity-50;
}
.switch::after {
  @apply absolute content-[''];
  inset: -8px -12px;
}
.switch-thumb {
  @apply bg-[var(--background)] pointer-events-none block size-4 rounded-full ring-0 transition-transform;
}
.switch[data-checked] .switch-thumb {
  transform: translateX(calc(100% - 2px));
}
.switch[data-unchecked] .switch-thumb {
  transform: translateX(0);
}
.dark .switch-thumb[data-unchecked] {
  @apply bg-[var(--foreground)];
}
.dark .switch-thumb[data-checked] {
  @apply bg-[var(--primary-foreground)];
}
</style>
