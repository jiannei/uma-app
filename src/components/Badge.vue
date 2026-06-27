<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline"

const props = withDefaults(
  defineProps<PrimitiveProps & {
    variant?: BadgeVariant
    class?: HTMLAttributes["class"]
  }>(),
  { as: "span", variant: "default" },
)
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    data-slot="badge"
    :data-variant="variant"
    :class="['badge', props.class]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
.badge {
  @apply h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap;
}
.badge[data-variant="default"] {
  @apply bg-[var(--primary)] text-[var(--primary-foreground)];
}
.badge[data-variant="secondary"] {
  @apply bg-[var(--secondary)] text-[var(--secondary-foreground)];
}
.badge[data-variant="destructive"] {
  @apply bg-[var(--destructive)]/10 dark:bg-[var(--destructive)]/20 text-[var(--destructive)];
}
.badge[data-variant="outline"] {
  @apply border-[var(--border)] text-[var(--foreground)];
}
</style>
