<script setup lang="ts">
// src/bubble/PillLayout.vue — Pill layout shell (compact + expanded).
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// Props:
//   - icon: string (emoji / icon character)
//   - summary: string (single-line summary)
//   - isExpanded: boolean
//   - kindColor: string (CSS color for icon chip bg)
//
// Emits:
//   - "expand": user clicked middle area (or ↓ key from middle focus)
//   - "collapse": user clicked ⌃ chip (or Esc from expanded)
//
// Slots:
//   - "expanded": content shown when isExpanded=true (provided by parent)

defineProps<{
  icon: string;
  summary: string;
  isExpanded: boolean;
  kindColor: string;
  dotColor?: string;
}>();

const emit = defineEmits<{
  (e: "expand"): void;
  (e: "collapse"): void;
}>();

function onMiddleClick() {
  emit("expand");
}

function onCollapseClick() {
  emit("collapse");
}
</script>

<template>
  <div
    class="pill-layout"
    :class="{ expanded: isExpanded }"
    :style="{
      width: '280pt',
      height: isExpanded ? 'auto' : '44pt',
      transition: `height 280ms cubic-bezier(0.32, 0.72, 0, 1)`,
    }"
  >
    <div class="pill-compact" v-if="!isExpanded">
      <div class="kind-dot" :style="{ background: dotColor }"></div>
      <button class="middle-button" @click="onMiddleClick" title="Click to expand" aria-label="Click to expand">
        <span class="summary-text">{{ summary }}</span>
      </button>
      <slot name="actions-compact"></slot>
    </div>
    <div class="pill-expanded" v-else>
      <div class="expanded-header">
        <div class="icon-chip-small" :style="{ background: kindColor }">
          {{ icon }}
        </div>
        <span class="expanded-title">
          <slot name="expanded-title"></slot>
        </span>
        <button class="collapse-chip" @click="onCollapseClick">⌃ 折起</button>
      </div>
      <div class="expanded-body">
        <slot name="expanded"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pill-layout {
  background: var(--bubble-bg);
  backdrop-filter: var(--bubble-bg-blur);
  -webkit-backdrop-filter: var(--bubble-bg-blur);
  box-shadow: var(--bubble-shadow);
  overflow: hidden;
  font: 13px/1 -apple-system, BlinkMacSystemFont, sans-serif;
  color: #f4f4f5;
  border-radius: 22pt;
  transition: border-radius 280ms cubic-bezier(0.32, 0.72, 0, 1);
}

.pill-layout.expanded {
  border-radius: 16pt;
}

.pill-compact {
  display: flex;
  align-items: center;
  padding: 0 6px 0 4px;
  gap: 4px;
  height: 100%;
}

.icon-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 18px;
  flex-shrink: 0;
  font-size: 16px;
  display: none;
}

.kind-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin: 0 8px 0 12px;
}

.middle-button {
  flex: 1;
  min-width: 0;
  height: 36px;
  margin: 0 4px;
  padding: 0 10px;
  border: none;
  background: transparent;
  color: #f4f4f5;
  font: inherit;
  text-align: left;
  cursor: pointer;
  border-radius: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background 200ms;
}

.middle-button:hover {
  background: rgba(255, 255, 255, 0.06);
}

.summary-text {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint-text {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  flex-shrink: 0;
  font-family: ui-monospace, monospace;
  transition: color 200ms;
  display: none;
}

.middle-button:hover .hint-text {
  color: rgba(255, 255, 255, 0.85);
}

.pill-expanded {
  display: flex;
  flex-direction: column;
}

.expanded-header {
  padding: 12px 14px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
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

.expanded-title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
}

.collapse-chip {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  color: #a1a1aa;
  border: none;
  cursor: pointer;
}

.expanded-body {
  max-height: 380pt;
  overflow-y: auto;
  padding: 0 14px 14px;
}

@media (prefers-reduced-motion: reduce) {
  .pill-layout {
    transition: none !important;
  }
}
</style>
