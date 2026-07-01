<script setup lang="ts">
// src/bubble/CommandBlock.vue — pre-formatted command / path preview.
// Used by UnifiedBubbleCard for SideEffect kind. Max 80pt tall,
// scrollable, monospace (see bubble.css .command-block).
defineProps<{
  preview: string;
}>();
</script>

<template>
  <div class="command-block">{{ preview }}</div>
</template>