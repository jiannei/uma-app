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
