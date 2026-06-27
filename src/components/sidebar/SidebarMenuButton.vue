<script setup lang="ts">
import type { Component } from "vue"
import type { SidebarMenuButtonProps } from "./SidebarMenuButtonChild.vue"
import { reactiveOmit } from "@vueuse/core"
import { TooltipRoot, TooltipTrigger, TooltipPortal } from "reka-ui"
import TooltipContent from "@/components/TooltipContent.vue"
import TooltipArrow from "@/components/TooltipArrow.vue"
import SidebarMenuButtonChild from "./SidebarMenuButtonChild.vue"
import { useSidebar } from "./utils"

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SidebarMenuButtonProps & {
  tooltip?: string | Component
}>(), {
  as: "button",
  variant: "default",
  size: "default",
})

const { isMobile, state } = useSidebar()

const delegatedProps = reactiveOmit(props, "tooltip")
</script>

<template>
  <SidebarMenuButtonChild v-if="!tooltip" v-bind="{ ...delegatedProps, ...$attrs }">
    <slot />
  </SidebarMenuButtonChild>

  <TooltipRoot v-else>
    <TooltipTrigger as-child>
      <SidebarMenuButtonChild v-bind="{ ...delegatedProps, ...$attrs }">
        <slot />
      </SidebarMenuButtonChild>
    </TooltipTrigger>
    <TooltipPortal>
      <TooltipContent
        side="right"
        align="center"
        :hidden="state !== 'collapsed' || isMobile"
      >
        <template v-if="typeof tooltip === 'string'">
          {{ tooltip }}
        </template>
        <component :is="tooltip" v-else />
        <TooltipArrow />
      </TooltipContent>
    </TooltipPortal>
  </TooltipRoot>
</template>
