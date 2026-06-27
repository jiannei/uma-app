<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import Input from "@/components/Input.vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Input
    data-slot="sidebar-input"
    data-sidebar="input"
    :class="['bg-[var(--background)] h-8 w-full shadow-none', props.class]"
  />
</template>
