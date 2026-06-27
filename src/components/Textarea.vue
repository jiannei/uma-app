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
  <textarea
    v-model="modelValue"
    data-slot="textarea"
    :class="['textarea', props.class]"
  />
</template>

<style scoped>
.textarea {
  @apply dark:bg-[var(--input)]/30 border-[var(--input)] focus-visible:border-[var(--ring)] focus-visible:ring-[var(--ring)]/50 disabled:bg-[var(--input)]/50 dark:disabled:bg-[var(--input)]/80 rounded-lg border bg-transparent px-2.5 py-2 text-base transition-colors focus-visible:ring-3 md:text-sm flex field-sizing-content min-h-16 w-full outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-not-allowed disabled:opacity-50;
}
.textarea:focus-visible {
  @apply border-[var(--ring)] ring-[var(--ring)]/50 ring-3;
}
.textarea:disabled {
  @apply bg-[var(--input)]/50 dark:bg-[var(--input)]/80 pointer-events-none cursor-not-allowed opacity-50;
}
.textarea::placeholder {
  @apply text-[var(--muted-foreground)];
}
.textarea[aria-invalid="true"] {
  @apply ring-[var(--destructive)]/20 dark:ring-[var(--destructive)]/40 border-[var(--destructive)] ring-3;
}
</style>