<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { useSidebar } from "./utils"

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const { toggleSidebar } = useSidebar()
</script>

<template>
  <button
    data-sidebar="rail"
    data-slot="sidebar-rail"
    aria-label="Toggle Sidebar"
    :tabindex="-1"
    title="Toggle Sidebar"
    :class="['sidebar-rail', props.class]"
    @click="toggleSidebar"
  >
    <slot />
  </button>
</template>

<style scoped>
.sidebar-rail {
  @apply absolute inset-y-0 z-20 hidden w-4 transition-all ease-linear sm:flex;
}
.sidebar-rail:hover::after {
  @apply bg-[var(--sidebar-border)];
}
.sidebar-rail::after {
  @apply absolute inset-y-0 start-1/2 w-0.5 content-[''];
}
[data-side="left"] .sidebar-rail {
  @apply -right-4;
}
[data-side="right"] .sidebar-rail {
  @apply left-0;
}
/* Cursors */
[data-side="left"] .sidebar-rail {
  cursor: w-resize;
}
[data-side="right"] .sidebar-rail {
  cursor: e-resize;
}
[data-side="left"][data-state="collapsed"] .sidebar-rail {
  cursor: e-resize;
}
[data-side="right"][data-state="collapsed"] .sidebar-rail {
  cursor: w-resize;
}
/* Offcanvas */
[data-collapsible="offcanvas"] .sidebar-rail {
  @apply translate-x-0;
}
[data-collapsible="offcanvas"] .sidebar-rail::after {
  left: 100%;
}
[data-side="left"][data-collapsible="offcanvas"] .sidebar-rail {
  @apply -right-2;
}
[data-side="right"][data-collapsible="offcanvas"] .sidebar-rail {
  @apply -left-2;
}
</style>
