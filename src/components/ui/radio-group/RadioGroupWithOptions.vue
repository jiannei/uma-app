<script setup lang="ts">
// High-level RadioGroup wrapper that accepts `options` prop.
//
// Renders a segmented-control style radio group:
//   - Pill container with bg-secondary/40 border
//   - Each option is a label wrapping a hidden RadioGroupItem
//   - Selected option highlighted with bg-background + shadow
//
// Why hide RadioGroupItem? shadcn-vue's RadioGroupItem is a
// 16x16 circular radio button — we want a fully custom segmented
// control look, so we keep the item in the DOM (for accessibility
// and keyboard nav) but hide it visually.

import { RadioGroup, RadioGroupItem } from ".";
import type { AcceptableValue } from "reka-ui";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  label: string;
  hint?: string;
}

withDefaults(defineProps<{
  modelValue: string;
  options: Option[];
  disabled?: boolean;
  orientation?: "horizontal" | "vertical";
}>(), {
  orientation: "horizontal",
});

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

function onValueChange(value: AcceptableValue) {
  emit("update:modelValue", String(value));
}
</script>

<template>
  <RadioGroup
    :model-value="modelValue"
    :disabled="disabled"
    :class="cn(
      'inline-flex gap-0.5 p-0.5 rounded-lg border border-border bg-secondary/40',
      orientation === 'vertical' ? 'flex-col w-full' : 'flex-row'
    )"
    @update:model-value="onValueChange"
  >
    <label
      v-for="opt in options"
      :key="opt.id"
      :class="cn(
        'relative inline-flex items-center justify-center',
        'px-3 py-1 rounded-md text-xs font-medium cursor-pointer select-none',
        'transition-colors duration-150 whitespace-nowrap',
        modelValue === opt.id
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )"
    >
      <RadioGroupItem
        :value="opt.id"
        class="sr-only"
      />
      {{ opt.label }}
    </label>
  </RadioGroup>
</template>
