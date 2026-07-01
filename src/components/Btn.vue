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
