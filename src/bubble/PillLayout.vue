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
  /** CSS color string (e.g. "#f59e0b") for the dot, used when dotColorClass is absent */
  dotColor?: string;
  /** Tailwind utility class for the dot (preferred over dotColor) */
  dotColorClass?: string;
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
      <div class="kind-dot" :class="dotColorClass" :style="dotColorClass ? undefined : { background: dotColor }"></div>
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
