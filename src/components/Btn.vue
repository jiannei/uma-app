<script setup lang="ts">
import { Primitive, type PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link"
export type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"

const props = withDefaults(
  defineProps<PrimitiveProps & {
    variant?: ButtonVariant
    size?: ButtonSize
    class?: HTMLAttributes["class"]
  }>(),
  {
    as: "button",
    variant: "default",
    size: "default",
  },
)
</script>

<template>
  <Primitive
    :as="as"
    :as-child="asChild"
    data-slot="button"
    :data-variant="variant"
    :data-size="size"
    :class="['btn', props.class]"
  >
    <slot />
  </Primitive>
</template>

<style scoped>
/* === Base === */
.btn {
  @apply rounded-lg border border-transparent bg-clip-padding text-sm font-medium inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none;
}
.btn:focus-visible {
  @apply border-[var(--ring)] ring-[var(--ring)]/50 ring-3;
}
.btn:disabled {
  @apply pointer-events-none opacity-50;
}

/* === Variants === */
.btn[data-variant="default"] {
  @apply bg-[var(--primary)] text-[var(--primary-foreground)];
}
.btn[data-variant="outline"] {
  @apply border-[var(--border)] bg-[var(--background)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] dark:bg-[var(--input)]/30 dark:border-[var(--input)] dark:hover:bg-[var(--input)]/50;
}
.btn[data-variant="secondary"] {
  @apply bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--secondary)]/80;
}
.btn[data-variant="ghost"] {
  @apply hover:bg-[var(--muted)] hover:text-[var(--foreground)] dark:hover:bg-[var(--muted)]/50;
}
.btn[data-variant="destructive"] {
  @apply bg-[var(--destructive)]/10 dark:bg-[var(--destructive)]/20 hover:bg-[var(--destructive)]/20 dark:hover:bg-[var(--destructive)]/30 text-[var(--destructive)] focus-visible:border-[var(--destructive)]/40;
}
.btn[data-variant="link"] {
  @apply text-[var(--primary)] underline-offset-4 hover:underline;
}

/* === Sizes === */
.btn[data-size="default"] {
  @apply h-8 gap-1.5 px-2.5;
}
.btn[data-size="default"]:has([data-icon="inline-end"]) {
  @apply pr-2;
}
.btn[data-size="default"]:has([data-icon="inline-start"]) {
  @apply pl-2;
}
.btn[data-size="xs"] {
  @apply h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs;
}
.btn[data-size="xs"]:has([data-icon="inline-end"]) {
  @apply pr-1.5;
}
.btn[data-size="xs"]:has([data-icon="inline-start"]) {
  @apply pl-1.5;
}
.btn[data-size="sm"] {
  @apply h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem];
}
.btn[data-size="sm"]:has([data-icon="inline-end"]) {
  @apply pr-1.5;
}
.btn[data-size="sm"]:has([data-icon="inline-start"]) {
  @apply pl-1.5;
}
.btn[data-size="lg"] {
  @apply h-9 gap-1.5 px-2.5;
}
.btn[data-size="lg"]:has([data-icon="inline-end"]) {
  @apply pr-2;
}
.btn[data-size="lg"]:has([data-icon="inline-start"]) {
  @apply pl-2;
}
.btn[data-size="icon"] {
  @apply size-8;
}
.btn[data-size="icon-xs"] {
  @apply size-6 rounded-[min(var(--radius-md),10px)];
}
.btn[data-size="icon-sm"] {
  @apply size-7 rounded-[min(var(--radius-md),12px)];
}
.btn[data-size="icon-lg"] {
  @apply size-9;
}
</style>
