<script setup lang="ts">
// src/components/ui/switch/Switch.vue — Reka UI SwitchRoot wrapper
// with Catppuccin Mocha styling. Two-way bound via `v-model`.
//
// Usage:
//   <Switch v-model="settings.dnd" @update:modelValue="toggleDnd" />

import { computed } from "vue";
import { SwitchRoot, SwitchThumb } from "reka-ui";

const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});
</script>

<template>
  <SwitchRoot
    v-model="value"
    :disabled="disabled"
    class="SwitchRoot"
  >
    <SwitchThumb class="SwitchThumb" />
  </SwitchRoot>
</template>

<style scoped>
.SwitchRoot {
  width: 38px;
  height: 22px;
  background-color: #45475a; /* ctp-surface1 */
  border-radius: 9999px;
  position: relative;
  border: none;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.SwitchRoot[data-state="checked"] {
  background-color: #89b4fa; /* ctp-blue */
}

.SwitchRoot[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.SwitchThumb {
  display: block;
  width: 18px;
  height: 18px;
  background-color: #cdd6f4; /* ctp-text */
  border-radius: 9999px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  transition: transform 0.15s ease;
  transform: translateX(2px);
  will-change: transform;
}

.SwitchThumb[data-state="checked"] {
  transform: translateX(18px);
  background-color: #1e1e2e; /* ctp-base (contrast against blue) */
}
</style>