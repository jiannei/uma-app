<script setup lang="ts">
// src/devtools/panels/VisualDebugPanel.vue — Panel 3.
//
// Visual debug controls for the pet window. The dev panel emits the
// current `windowBg` / `spriteBg` / `hitzoneBg` colors via the
// `devtools-pet-debug-style` Tauri event; pet.html applies them as
// CSS variables (see docs/adr/0005-dev-tools.md D9). State is
// in-memory only — restart the app to reset to defaults.

import { reactive } from "vue";
import { emit as tauriEmit } from "@tauri-apps/api/event";

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
  await tauriEmit("devtools-pet-debug-style", { ...style });
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
  <section class="panel">
    <h2>Visual Debug</h2>
    <div class="body">
      <div class="row">
        <label>Window BG</label>
        <input type="color" v-model="style.windowBg" @change="broadcast" />
        <button class="mini" @click="style.windowBg = DEFAULT_WINDOW; broadcast()">red</button>
      </div>
      <div class="row">
        <label>Sprite BG</label>
        <input type="color" v-model="style.spriteBg" @change="broadcast" />
        <button class="mini" @click="style.spriteBg = DEFAULT_SPRITE; broadcast()">blue</button>
      </div>
      <div class="row">
        <label>Hit-zone BG</label>
        <input type="color" v-model="style.hitzoneBg" @change="broadcast" />
        <button class="mini" @click="style.hitzoneBg = DEFAULT_HITZONE; broadcast()">green</button>
      </div>
      <button class="clear" @click="clearAll">Clear All</button>
      <p class="hint">
        Colors apply to the pet window. Pick freely; this is in-memory
        only — restart the app to reset.
      </p>
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: #181825;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
h2 {
  font-size: 11px;
  font-weight: 600;
  color: #a6adc8;
  padding: 6px 10px;
  border-bottom: 1px solid #313244;
  background: #1e1e2e;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.body {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-size: 11px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
}
label {
  flex: 1;
  font-size: 11px;
  color: #cdd6f4;
}
input[type="color"] {
  width: 32px;
  height: 24px;
  border: 1px solid #313244;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  padding: 0;
}
.mini {
  background: #313244;
  color: #cdd6f4;
  border: none;
  border-radius: 3px;
  padding: 3px 8px;
  font-size: 10px;
  cursor: pointer;
  font-family: inherit;
}
.mini:hover { background: #45475a; }
.clear {
  background: #45475a;
  color: #cdd6f4;
  border: none;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 4px;
  font-family: inherit;
}
.clear:hover { background: #585b70; }
.hint {
  font-size: 10px;
  color: #6c7086;
  margin-top: 4px;
  line-height: 1.4;
}
</style>
