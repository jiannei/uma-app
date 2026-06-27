<script setup lang="ts">
import type { SidebarProps } from "."
import { useSidebar } from "./utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SidebarProps>(), {
  side: "left",
  variant: "sidebar",
  collapsible: "offcanvas",
})

const { state } = useSidebar()
</script>

<template>
  <div
    v-if="collapsible === 'none'"
    data-slot="sidebar"
    :class="['sidebar-base', props.class]"
    v-bind="$attrs"
  >
    <slot />
  </div>

  <div
    v-else
    class="group peer text-[var(--sidebar-foreground)] hidden md:block"
    data-slot="sidebar"
    :data-state="state"
    :data-collapsible="state === 'collapsed' ? collapsible : ''"
    :data-variant="variant"
    :data-side="side"
  >
    <div
      data-slot="sidebar-gap"
      :class="[
        'sidebar-gap',
        side === 'right' && 'rotate-180',
      ]"
    />
    <div
      data-slot="sidebar-container"
      :data-side="side"
      :class="[
        'sidebar-container',
        side === 'left' ? 'left-0' : 'right-0',
        variant === 'floating' || variant === 'inset' ? 'sidebar-container-floating' : 'sidebar-container-default',
        props.class,
      ]"
      v-bind="$attrs"
    >
      <div
        data-sidebar="sidebar"
        data-slot="sidebar-inner"
        :class="[
          'sidebar-inner',
          variant === 'floating' && 'sidebar-inner-floating',
        ]"
      >
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-base {
  @apply bg-[var(--sidebar)] text-[var(--sidebar-foreground)] flex h-full w-[var(--sidebar-width)] flex-col;
}
.sidebar-gap {
  @apply transition-[width] duration-200 ease-linear relative w-[var(--sidebar-width)] bg-transparent;
}
.sidebar-container {
  @apply fixed inset-y-0 z-10 hidden h-svh w-[var(--sidebar-width)] transition-[left,right,width] duration-200 ease-linear md:flex;
}
.sidebar-container-default {
  @apply group-data-[collapsible=icon]:w-[var(--sidebar-width-icon)];
}
[data-side="left"] .sidebar-container-default {
  @apply group-data-[side=left]:border-r;
}
[data-side="right"] .sidebar-container-default {
  @apply group-data-[side=right]:border-l;
}
.sidebar-container-floating {
  @apply p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)];
}
.sidebar-inner {
  @apply bg-[var(--sidebar)] flex size-full flex-col;
}
.sidebar-inner-floating {
  @apply group-data-[variant=floating]:ring-[var(--sidebar-border)] group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1;
}
/* Offcanvas collapse */
[data-collapsible="offcanvas"] .sidebar-gap {
  width: 0;
}
[data-side="left"][data-collapsible="offcanvas"] .sidebar-container {
  left: calc(var(--sidebar-width) * -1);
}
[data-side="right"][data-collapsible="offcanvas"] .sidebar-container {
  right: calc(var(--sidebar-width) * -1);
}
/* Icon collapse */
[data-collapsible="icon"] .sidebar-container-default {
  width: var(--sidebar-width-icon);
}
[data-collapsible="icon"] .sidebar-container-floating {
  width: calc(var(--sidebar-width-icon) + var(--spacing, 1rem) * 4 + 2px);
}
</style>
