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
