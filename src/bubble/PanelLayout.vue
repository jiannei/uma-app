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

<style scoped>
.panel-layout {
  width: 600pt;
  max-height: 600pt;
  border-radius: 14px;
  background: var(--bubble-bg);
  backdrop-filter: var(--bubble-bg-blur);
  -webkit-backdrop-filter: var(--bubble-bg-blur);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.42);
  color: #f4f4f5;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.panel-header {
  height: 44px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.icon-chip-small {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 14px;
  flex-shrink: 0;
  font-size: 14px;
}

.panel-title {
  font-weight: 600;
  font-size: 13px;
}

.panel-header-right {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px;
}

.panel-footer {
  height: 52px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.18);
}

@media (prefers-reduced-motion: reduce) {
  .panel-layout {
    transition: none !important;
  }
}
</style>
