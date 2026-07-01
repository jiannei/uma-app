<script setup lang="ts">
// src/bubble/PanelLayout.vue — Panel layout shell (header + body + footer).
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - icon: string (emoji / icon character)
//   - title: string
//   - kindColor: string (CSS color for icon chip bg)
//
// Slots:
//   - "header-right": right side of header (e.g., progress dots, read %)
//   - "body": main content (scrollable)
//   - "footer": decision buttons

defineProps<{
  icon: string;
  title: string;
  kindColor: string;
}>();
</script>

<template>
  <div class="panel-layout">
    <div class="panel-header">
      <div class="icon-chip-small" :style="{ background: kindColor }">
        {{ icon }}
      </div>
      <span class="panel-title">{{ title }}</span>
      <span class="panel-header-right">
        <slot name="header-right"></slot>
      </span>
    </div>

    <div class="panel-body">
      <slot name="body"></slot>
    </div>

    <div class="panel-footer">
      <slot name="footer"></slot>
    </div>
  </div>
</template>
