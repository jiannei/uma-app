<!-- src/components/ModeToggle.vue — light/dark theme toggle.

Uses `useDark()` from @vueuse/core for 2-way theme switching.
Persists to localStorage with default key `vueuse-color-scheme`.
Automatically syncs `.dark` class on <html> element (UnoCSS's `dark:` variant matches this).

Placed in the "General" settings row (alongside Theme / DND / Sound).
-->
<script setup lang="ts">
import { useDark, useToggle } from "@vueuse/core";
import Button from "@/components/Btn.vue";

const isDark = useDark();
const toggleDark = useToggle(isDark);
</script>

<template>
  <div class="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--muted)] p-0.5">
    <Button
      variant="ghost"
      size="sm"
      :class="[
        'h-7 px-3 text-[12.5px] font-normal',
        !isDark
          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
      ]"
      @click="toggleDark(false)"
    >
      <div class="i-lucide-sun mr-1.5 h-3.5 w-3.5" />
      Light
    </Button>
    <Button
      variant="ghost"
      size="sm"
      :class="[
        'h-7 px-3 text-[12.5px] font-normal',
        isDark
          ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
      ]"
      @click="toggleDark(true)"
    >
      <div class="i-lucide-moon mr-1.5 h-3.5 w-3.5" />
      Dark
    </Button>
  </div>
</template>
