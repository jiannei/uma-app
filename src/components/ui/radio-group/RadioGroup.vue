<script setup lang="ts">
// src/components/ui/radio-group/RadioGroup.vue — Reka UI
// RadioGroupRoot wrapper with Catppuccin Mocha styling.
//
// Each item is a label/card containing a radio input; the
// group tracks selection via `v-model` on a shared string.
//
// Usage:
//   <RadioGroup v-model="settings.theme" :options="themes" />

import { computed } from "vue";
import {
  RadioGroupRoot,
  RadioGroupItem,
} from "reka-ui";

interface Option {
  id: string;
  label: string;
  /** Optional secondary text rendered under the label. */
  hint?: string;
}

const props = defineProps<{
  modelValue: string;
  options: Option[];
  disabled?: boolean;
  /** Layout direction for the option grid. */
  orientation?: "horizontal" | "vertical";
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const value = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});
</script>

<template>
  <RadioGroupRoot
    v-model="value"
    :disabled="disabled"
    :class="['RadioGroupRoot', orientation === 'vertical' ? 'vertical' : 'horizontal']"
  >
    <RadioGroupItem
      v-for="opt in options"
      :key="opt.id"
      :value="opt.id"
      class="RadioGroupItem"
    >
      <div class="RadioGroupItemLabel">{{ opt.label }}</div>
      <div v-if="opt.hint" class="RadioGroupItemHint">{{ opt.hint }}</div>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.RadioGroupRoot {
  display: grid;
  gap: 10px;
}
.RadioGroupRoot.horizontal {
  grid-template-columns: repeat(2, 1fr);
}
.RadioGroupRoot.vertical {
  grid-template-columns: 1fr;
}

.RadioGroupItem {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 14px 12px;
  background: #1e1e2e;
  border: 2px solid transparent;
  border-radius: 8px;
  color: #cdd6f4;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  text-align: center;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.RadioGroupItem:hover {
  background: #313244;
}

.RadioGroupItem[data-state="checked"] {
  border-color: #89b4fa;
  background: #313244;
}

.RadioGroupItem[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}

.RadioGroupItemLabel {
  font-weight: 500;
}

.RadioGroupItemHint {
  font-size: 11px;
  color: #a6adc8;
}
</style>