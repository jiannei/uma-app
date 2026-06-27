<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useVModel } from "@vueuse/core"

const props = defineProps<{
  defaultValue?: string | number
  modelValue?: string | number
  class?: HTMLAttributes["class"]
}>()

const emits = defineEmits<{
  (e: "update:modelValue", payload: string | number): void
}>()

const modelValue = useVModel(props, "modelValue", emits, {
  passive: true,
  defaultValue: props.defaultValue,
})
</script>

<template>
  <input
    v-model="modelValue"
    data-slot="input"
    :class="['input', props.class]"
  >
</template>

<style scoped>
.input {
  @apply dark:bg-[var(--input)]/30 border-[var(--input)] h-8 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors w-full min-w-0 outline-none md:text-sm;
}
.input:focus-visible {
  @apply border-[var(--ring)] ring-[var(--ring)]/50 ring-3;
}
.input:disabled {
  @apply bg-[var(--input)]/50 dark:bg-[var(--input)]/80 pointer-events-none cursor-not-allowed opacity-50;
}
.input::placeholder {
  @apply text-[var(--muted-foreground)];
}
.input[type="file"] {
  @apply h-6 text-sm font-medium;
}
</style>
