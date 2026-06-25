// src/components/ModeToggle.vue — dark/light/system theme toggle.
//
// Follows the shadcn-vue dark mode guide for Vite:
// https://www.shadcn-vue.com/docs/dark-mode/vite
// Uses @vueuse/core's `useColorMode()` which persists to localStorage
// and syncs with the `.dark` class on the root element.
//
// Placed in the "General" settings row (alongside Theme / DND / Sound).
// The toggle is a 3-option segmented control (Light / Dark / System),
// not a dropdown — matches the existing RadioGroup pattern used for
// Bubble position.

<script setup lang="ts">
import { watchEffect } from "vue";
import { useColorMode, usePreferredDark } from "@vueuse/core";
import { Sun, Moon, Monitor } from "@lucide/vue";
import { Button } from "@/components/ui/button";

const mode = useColorMode({ disableTransition: false });
const preferredDark = usePreferredDark();

// Sync `.dark` class on <html>. useColorMode in "auto" doesn't do this
// automatically — Tailwind's @custom-variant dark requires the actual class.
watchEffect(() => {
  const isDark =
    mode.value === "dark" || (mode.value === "auto" && preferredDark.value);
  document.documentElement.classList.toggle("dark", isDark);
});

type Mode = "light" | "dark" | "auto";

const OPTIONS: { value: Mode; label: string; icon: any }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "auto", label: "System", icon: Monitor },
];
</script>

<template>
  <div class="inline-flex items-center rounded-lg border border-border bg-muted p-0.5">
    <Button
      v-for="opt in OPTIONS"
      :key="opt.value"
      variant="ghost"
      size="sm"
      :class="[
        'h-7 px-3 text-[12.5px] font-normal',
        mode === opt.value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="mode = opt.value"
    >
      <component :is="opt.icon" class="mr-1.5 h-3.5 w-3.5" />
      {{ opt.label }}
    </Button>
  </div>
</template>
