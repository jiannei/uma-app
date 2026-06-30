<script setup lang="ts">
// src/bubble/BubbleIdle.vue — Empty state (0pt placeholder).
// Spec: docs/superpowers/specs/2026-06-30-bubble-display-design.md
//
// When queue is empty, render nothing. Tauri window auto-hide handles
// the actual window visibility; this component is just a placeholder.
</script>

<template>
  <!-- 0pt placeholder, no content -->
  <div style="width: 0; height: 0;"></div>
</template>
