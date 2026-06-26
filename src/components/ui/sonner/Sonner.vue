<script setup lang="ts">
// src/components/ui/sonner/Sonner.vue — shadcn-vue 风格 Sonner wrapper。
//
// 用途：权限气泡的药丸态 — 多个 permission request 自动堆叠显示。
// expanded 态（SideEffect / Elicitation / PlanReview）不走 toast，
// 走原 expand 流程 + window resize。

import { Toaster as Sonner } from 'vue-sonner'
</script>

<template>
  <Sonner
    class="toaster group"
    position="top-center"
    :expand="true"
    :visible-toasts="1"
    :gap="0"
    :duration="Infinity"
    :toast-options="{
      classes: {
        toast: 'group toast group-[.toaster]:bg-transparent group-[.toaster]:text-foreground group-[.toaster]:border-0 group-[.toaster]:shadow-none group-[.toaster]:p-0',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
  />
</template>
