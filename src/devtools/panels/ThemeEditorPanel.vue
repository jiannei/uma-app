<script setup lang="ts">
// src/devtools/panels/ThemeEditorPanel.vue — Visual editor for theme
// objectScale. Lets a developer nudge a sprite's size/position
// without hand-editing theme.json. Reads the current theme via
// theme_load, writes back via theme_save. After save, the pet window
// re-reads theme.json (theme-updated event from Rust) and re-renders
// the sprite with the new values — no restart needed.
//
// Scope (per grilling-session B): base 4 fields
// (widthRatio/heightRatio/offsetX/offsetY) + per-file
// fileScales/fileOffsets.

import { ref, computed, watch, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";

// Hardcoded for now; could come from a Rust theme_list command
// that scans public/themes/ if we add many.
const KNOWN_THEMES = ["uma", "calico"];

interface FileOffset { x: number; y: number; }
interface ObjectScale {
  widthRatio?: number;
  heightRatio?: number;
  imgWidthRatio?: number;
  offsetX?: number;
  offsetY?: number;
  imgBottom?: number;
  objBottom?: number;
  fileScales?: Record<string, number>;
  fileOffsets?: Record<string, FileOffset>;
}
interface StateDef { file: string; type: string; }
interface ThemeJson {
  name?: string;
  objectScale?: ObjectScale;
  states?: Record<string, StateDef>;
}

const selectedThemeId = ref<string>("uma");
const theme = ref<ThemeJson | null>(null);
const selectedFile = ref<string>("");
const isDirty = ref(false);
const isLoading = ref(false);
const isSaving = ref(false);
const error = ref<string>("");
const saveBanner = ref<string>("");

const fileList = computed(() => {
  if (!theme.value?.states) return [];
  return Object.entries(theme.value.states).map(([state, def]) => ({
    state,
    file: def.file,
    type: def.type,
  }));
});

const fileScale = computed(() => {
  if (!theme.value?.objectScale?.fileScales || !selectedFile.value) return undefined;
  return theme.value.objectScale.fileScales[selectedFile.value];
});
const fileOffset = computed(() => {
  if (!theme.value?.objectScale?.fileOffsets || !selectedFile.value) return undefined;
  return theme.value.objectScale.fileOffsets[selectedFile.value];
});

function markDirty() { isDirty.value = true; saveBanner.value = ""; }

async function loadTheme(themeId: string) {
  isLoading.value = true;
  error.value = "";
  saveBanner.value = "";
  try {
    const manifest = await invoke<ThemeJson>("theme_load", { themeId });
    theme.value = manifest;
    // Pick the first file as preview target
    const firstFile = manifest.states ? Object.values(manifest.states)[0]?.file : null;
    selectedFile.value = firstFile || "";
    isDirty.value = false;
  } catch (e) {
    error.value = String(e);
    theme.value = null;
  } finally {
    isLoading.value = false;
  }
}

async function save() {
  if (!theme.value || !isDirty.value) return;
  isSaving.value = true;
  error.value = "";
  try {
    await invoke("theme_save", {
      themeId: selectedThemeId.value,
      content: theme.value,
    });
    isDirty.value = false;
    saveBanner.value = `Saved ${selectedThemeId.value} at ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    error.value = String(e);
  } finally {
    isSaving.value = false;
  }
}

function setBaseField(field: keyof ObjectScale, value: number) {
  if (!theme.value) return;
  if (!theme.value.objectScale) theme.value.objectScale = {};
  (theme.value.objectScale as Record<string, unknown>)[field] = value;
  markDirty();
}

function setFileScale(value: number | null) {
  if (!theme.value?.objectScale || !selectedFile.value) return;
  if (!theme.value.objectScale.fileScales) theme.value.objectScale.fileScales = {};
  if (value === null || Number.isNaN(value)) {
    delete theme.value.objectScale.fileScales[selectedFile.value];
  } else {
    theme.value.objectScale.fileScales[selectedFile.value] = value;
  }
  markDirty();
}

function setFileOffset(axis: "x" | "y", value: number | null) {
  if (!theme.value?.objectScale || !selectedFile.value) return;
  if (!theme.value.objectScale.fileOffsets) theme.value.objectScale.fileOffsets = {};
  const current = theme.value.objectScale.fileOffsets[selectedFile.value] || { x: 0, y: 0 };
  if (value === null || Number.isNaN(value)) {
    if (axis === "x") current.x = 0; else current.y = 0;
  } else {
    current[axis] = value;
  }
  theme.value.objectScale.fileOffsets[selectedFile.value] = current;
  markDirty();
}

watch(selectedThemeId, (id) => { if (id) loadTheme(id); });
onMounted(() => { loadTheme(selectedThemeId.value); });
</script>

<template>
  <section class="panel theme-editor">
    <header><h3>Theme Editor</h3></header>
    <div class="body" v-if="isLoading"><span>Loading…</span></div>
    <div class="body" v-else-if="!theme"><span class="err">{{ error || "No theme loaded" }}</span></div>
    <div class="body" v-else>
      <div class="row">
        <label>Theme
          <select v-model="selectedThemeId">
            <option v-for="id in KNOWN_THEMES" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <span class="dirty" v-if="isDirty">unsaved</span>
        <button class="save" :disabled="!isDirty || isSaving" @click="save">
          {{ isSaving ? "Saving…" : "Save" }}
        </button>
      </div>

      <fieldset>
        <legend>Base (objectScale)</legend>
        <div class="grid-2">
          <label>widthRatio
            <input type="number" step="0.01"
              :value="theme.objectScale?.widthRatio ?? ''"
              @input="setBaseField('widthRatio', +($event.target as HTMLInputElement).value)" />
          </label>
          <label>heightRatio
            <input type="number" step="0.01"
              :value="theme.objectScale?.heightRatio ?? ''"
              @input="setBaseField('heightRatio', +($event.target as HTMLInputElement).value)" />
          </label>
          <label>offsetX
            <input type="number" step="0.01"
              :value="theme.objectScale?.offsetX ?? ''"
              @input="setBaseField('offsetX', +($event.target as HTMLInputElement).value)" />
          </label>
          <label>offsetY
            <input type="number" step="0.01"
              :value="theme.objectScale?.offsetY ?? ''"
              @input="setBaseField('offsetY', +($event.target as HTMLInputElement).value)" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Per-file (fileScales / fileOffsets)</legend>
        <label class="file-select">File
          <select v-model="selectedFile">
            <option v-for="f in fileList" :key="f.file" :value="f.file">
              {{ f.state }} → {{ f.file }} ({{ f.type }})
            </option>
          </select>
        </label>
        <div class="grid-3">
          <label>scale
            <input type="number" step="0.01" placeholder="(default 1.0)"
              :value="fileScale ?? ''"
              @input="setFileScale(+($event.target as HTMLInputElement).value)" />
          </label>
          <label>offsetX
            <input type="number" step="1" placeholder="0"
              :value="fileOffset?.x ?? ''"
              @input="setFileOffset('x', +($event.target as HTMLInputElement).value)" />
          </label>
          <label>offsetY
            <input type="number" step="1" placeholder="0"
              :value="fileOffset?.y ?? ''"
              @input="setFileOffset('y', +($event.target as HTMLInputElement).value)" />
          </label>
        </div>
        <p class="hint">fileScales/fileOffsets keys match the SVG/APNG filename. Empty values delete the override.</p>
      </fieldset>

      <p class="banner err" v-if="error">{{ error }}</p>
      <p class="banner ok" v-if="saveBanner">{{ saveBanner }}</p>
    </div>
  </section>
</template>

<style scoped>
.theme-editor { display: flex; flex-direction: column; min-height: 0; }
.theme-editor header h3 {
  font-size: 11px; font-weight: 600; letter-spacing: 0.4px; text-transform: uppercase;
  color: #cdd6f4; margin: 0;
}
.theme-editor .body {
  padding: 8px 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px;
  font-size: 11px;
}
.theme-editor .row { display: flex; align-items: center; gap: 8px; }
.theme-editor .row .dirty {
  color: #f9e2af; font-size: 10px; font-weight: 600;
  background: #45475a; padding: 1px 6px; border-radius: 3px;
}
.theme-editor .row .save {
  margin-left: auto;
  background: #a6e3a1; color: #1e1e2e; border: none; border-radius: 4px;
  padding: 4px 12px; font-size: 11px; font-weight: 600; cursor: pointer;
}
.theme-editor .row .save:disabled { background: #45475a; color: #6c7086; cursor: default; }
.theme-editor fieldset {
  border: 1px solid #313244; border-radius: 4px; padding: 6px 8px;
  display: flex; flex-direction: column; gap: 6px;
}
.theme-editor legend {
  color: #89b4fa; font-size: 10px; font-weight: 600; padding: 0 4px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.theme-editor label {
  display: flex; flex-direction: column; gap: 2px; color: #a6adc8; font-size: 10px;
}
.theme-editor input,
.theme-editor select {
  background: #1e1e2e; color: #cdd6f4; border: 1px solid #313244;
  border-radius: 3px; padding: 3px 6px; font-size: 11px;
  font-family: ui-monospace, "SF Mono", monospace;
}
.theme-editor input:focus,
.theme-editor select:focus { outline: 1px solid #89b4fa; }
.theme-editor .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.theme-editor .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
.theme-editor .file-select { grid-column: 1 / -1; }
.theme-editor .hint { color: #6c7086; font-size: 10px; margin: 0; }
.theme-editor .banner { font-size: 10px; margin: 0; padding: 4px 6px; border-radius: 3px; }
.theme-editor .banner.err { background: #f38ba8; color: #1e1e2e; }
.theme-editor .banner.ok { background: #a6e3a1; color: #1e1e2e; }
</style>
