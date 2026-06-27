<script setup lang="ts">
// src/devtools/panels/VisualDebugPanel.vue — Panel 3.
//
// Visual debug controls for the robot window. The dev panel emits the
// current `windowBg` / `spriteBg` / `hitzoneBg` colors via the
// `devtools-robot-debug-style` Tauri event; robot.html applies them as
// CSS variables (see docs/adr/0005-dev-tools.md D9). State is
// in-memory only — restart the app to reset to defaults.

import { reactive } from "vue";
import { emit as tauriEmit } from "@tauri-apps/api/event";
import Button from "@/components/Btn.vue";

interface DebugStyle {
  windowBg: string | null;
  spriteBg: string | null;
  hitzoneBg: string | null;
}

const style = reactive<DebugStyle>({
  windowBg: null,
  spriteBg: null,
  hitzoneBg: null,
});

async function broadcast() {
  // Send a shallow clone so the reactive object isn't shared by ref.
  await tauriEmit("devtools-robot-debug-style", { ...style });
}

function clearAll() {
  style.windowBg = null;
  style.spriteBg = null;
  style.hitzoneBg = null;
  void broadcast();
}

// Default colors for the picker initial value (a sensible debug hue).
const DEFAULT_WINDOW = "#ff000033"; // translucent red — see window bounds
const DEFAULT_SPRITE = "#0000ff33"; // translucent blue — see sprite rect
const DEFAULT_HITZONE = "#00ff0033"; // translucent green — see drag area
</script>

<template>
  <section class="bg-[var(--card)] flex flex-col min-h-0 min-w-0">
    <h2 class="text-[11px] font-semibold text-[var(--muted-foreground)] px-2.5 py-1.5 border-b border-[var(--border)] bg-[var(--secondary)]/30 tracking-wider uppercase">
      Visual Debug
    </h2>
    <div class="flex-1 overflow-auto p-2 text-[11px] flex flex-col gap-1.5">
      <div class="flex items-center gap-1.5">
        <label class="flex-1 text-[11px] text-[var(--foreground)]">Window BG</label>
        <input
          type="color"
          v-model="style.windowBg"
          @change="broadcast"
          class="w-8 h-6 border border-[var(--border)] rounded bg-transparent cursor-pointer p-0"
        />
        <Button
          variant="secondary"
          size="sm"
          class="h-6 px-2 text-[10px]"
          @click="style.windowBg = DEFAULT_WINDOW; broadcast()"
        >
          red
        </Button>
      </div>
      <div class="flex items-center gap-1.5">
        <label class="flex-1 text-[11px] text-[var(--foreground)]">Sprite BG</label>
        <input
          type="color"
          v-model="style.spriteBg"
          @change="broadcast"
          class="w-8 h-6 border border-[var(--border)] rounded bg-transparent cursor-pointer p-0"
        />
        <Button
          variant="secondary"
          size="sm"
          class="h-6 px-2 text-[10px]"
          @click="style.spriteBg = DEFAULT_SPRITE; broadcast()"
        >
          blue
        </Button>
      </div>
      <div class="flex items-center gap-1.5">
        <label class="flex-1 text-[11px] text-[var(--foreground)]">Hit-zone BG</label>
        <input
          type="color"
          v-model="style.hitzoneBg"
          @change="broadcast"
          class="w-8 h-6 border border-[var(--border)] rounded bg-transparent cursor-pointer p-0"
        />
        <Button
          variant="secondary"
          size="sm"
          class="h-6 px-2 text-[10px]"
          @click="style.hitzoneBg = DEFAULT_HITZONE; broadcast()"
        >
          green
        </Button>
      </div>
      <Button
        variant="secondary"
        class="mt-1"
        @click="clearAll"
      >
        Clear All
      </Button>
      <p class="text-[10px] text-[var(--muted-foreground)] mt-1 leading-snug">
        Colors apply to the robot window. Pick freely; this is in-memory
        only — restart the app to reset.
      </p>
    </div>
  </section>
</template>
