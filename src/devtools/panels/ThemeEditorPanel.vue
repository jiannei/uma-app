<script setup lang="ts">
// src/devtools/panels/ThemeEditorPanel.vue — Visual editor for theme
// objectScale. Lets a developer nudge a sprite's size/position
// without hand-editing theme.json. Reads the current theme via
// theme_load, writes back via theme_save. After save, the robot window
// re-reads theme.json (theme-updated event from Rust) and re-renders
// the sprite with the new values — no restart needed.
//
// Scope (per grilling-session B): base 4 fields
// (widthRatio/heightRatio/offsetX/offsetY) + per-file
// fileScales/fileOffsets.

import { ref, computed, watch, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

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
  <section class="bg-card flex flex-col min-h-0 theme-editor">
    <header class="text-[11px] font-semibold text-muted-foreground px-2.5 py-1.5 border-b border-border bg-secondary/30 tracking-wider uppercase">
      <h3 class="m-0 text-foreground">Theme Editor</h3>
    </header>
    <div v-if="isLoading" class="flex-1 overflow-auto p-2 text-[11px] flex flex-col gap-2">
      <span class="text-muted-foreground">Loading…</span>
    </div>
    <div v-else-if="!theme" class="flex-1 overflow-auto p-2 text-[11px] flex flex-col gap-2">
      <span class="text-destructive">{{ error || "No theme loaded" }}</span>
    </div>
    <div v-else class="flex-1 overflow-auto p-2 text-[11px] flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
          Theme
          <select v-model="selectedThemeId" class="bg-secondary border border-border text-foreground rounded px-1.5 py-1 font-mono text-[11px] focus:border-ring focus:outline-none">
            <option v-for="id in KNOWN_THEMES" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <Badge v-if="isDirty" variant="secondary" class="text-[10px] font-semibold">
          unsaved
        </Badge>
        <Button
          class="ml-auto"
          :disabled="!isDirty || isSaving"
          @click="save"
        >
          {{ isSaving ? "Saving…" : "Save" }}
        </Button>
      </div>

      <fieldset class="border border-border rounded p-1.5 flex flex-col gap-1.5">
        <legend class="text-primary text-[10px] font-semibold px-1 tracking-wider uppercase">Base (objectScale)</legend>
        <div class="grid grid-cols-2 gap-1.5">
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            widthRatio
            <Input type="number" step="0.01"
              :model-value="theme.objectScale?.widthRatio ?? ''"
              @input="setBaseField('widthRatio', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            heightRatio
            <Input type="number" step="0.01"
              :model-value="theme.objectScale?.heightRatio ?? ''"
              @input="setBaseField('heightRatio', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            offsetX
            <Input type="number" step="0.01"
              :model-value="theme.objectScale?.offsetX ?? ''"
              @input="setBaseField('offsetX', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            offsetY
            <Input type="number" step="0.01"
              :model-value="theme.objectScale?.offsetY ?? ''"
              @input="setBaseField('offsetY', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
        </div>
      </fieldset>

      <fieldset class="border border-border rounded p-1.5 flex flex-col gap-1.5">
        <legend class="text-primary text-[10px] font-semibold px-1 tracking-wider uppercase">Per-file (fileScales / fileOffsets)</legend>
        <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase col-span-full">
          File
          <select v-model="selectedFile" class="bg-secondary border border-border text-foreground rounded px-1.5 py-1 font-mono text-[11px] focus:border-ring focus:outline-none">
            <option v-for="f in fileList" :key="f.file" :value="f.file">
              {{ f.state }} → {{ f.file }} ({{ f.type }})
            </option>
          </select>
        </label>
        <div class="grid grid-cols-3 gap-1.5">
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            scale
            <Input type="number" step="0.01" placeholder="(default 1.0)"
              :model-value="fileScale ?? ''"
              @input="setFileScale(+($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            offsetX
            <Input type="number" step="1" placeholder="0"
              :model-value="fileOffset?.x ?? ''"
              @input="setFileOffset('x', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
          <label class="flex flex-col gap-0.5 text-[10px] text-muted-foreground uppercase">
            offsetY
            <Input type="number" step="1" placeholder="0"
              :model-value="fileOffset?.y ?? ''"
              @input="setFileOffset('y', +($event.target as HTMLInputElement).value)"
              class="h-7 font-mono text-[11px]" />
          </label>
        </div>
        <p class="text-muted-foreground text-[10px] m-0">fileScales/fileOffsets keys match the SVG/APNG filename. Empty values delete the override.</p>
      </fieldset>

      <p v-if="error" class="text-[10px] m-0 p-1 rounded bg-destructive text-destructive-foreground">
        {{ error }}
      </p>
      <p v-if="saveBanner" class="text-[10px] m-0 p-1 rounded bg-primary text-primary-foreground">
        {{ saveBanner }}
      </p>
    </div>
  </section>
</template>
