<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import Button from '@/components/Btn.vue'
import { useSidebar } from "./utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <Button
    data-sidebar="trigger"
    data-slot="sidebar-trigger"
    variant="ghost"
    size="icon-sm"
    :class="props.class"
    @click="toggleSidebar"
  >
    <!-- preset-icons replaces @lucide/vue PanelLeftIcon -->
    <div class="icon-lucide-panel-left cn-rtl-flip" />
    <span class="sr-only">Toggle Sidebar</span>
  </Button>
</template>
