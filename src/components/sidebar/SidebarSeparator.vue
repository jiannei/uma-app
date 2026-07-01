<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import Separator from "@/components/Separator.vue"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <Separator
    data-slot="sidebar-separator"
    data-sidebar="separator"
    :class="['sidebar-separator', props.class]"
  />
</template>
