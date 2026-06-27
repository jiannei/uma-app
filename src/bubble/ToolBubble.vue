<script setup lang="ts">
// src/bubble/ToolBubble.vue — SideEffect 展开态（ADR-0017 Q3 终简版）。
//
// plain text 按钮列表：Allow once + 每个 permission_suggestion 一行 + Deny。
// 顶部 mono block 用 format-side-effect.ts 提取命令/文件路径预览。
//
// emit:
//   "allow" + [PermissionUpdateEntry]  →  Allow once 或 Allow + rule
//   "deny"                              →  Deny

import { computed, ref, watch, nextTick, type ComponentPublicInstance } from "vue";
import type {
  PermissionUpdateEntry,
  SideEffectRequest,
} from "../types/permission";
import { classifySideEffect } from "./format-side-effect";
import { useBubbleLang } from "./lang";
import { suggestionLabel } from "./suggestion-label";

const lang = useBubbleLang();

const props = defineProps<{
  request: SideEffectRequest;
}>();

const emit = defineEmits<{
  allow: [updatedPermissions?: PermissionUpdateEntry[]];
  deny: [];
}>();

const render = computed(() =>
  classifySideEffect(props.request.toolName, props.request.toolInput),
);

const preview = computed<string>(() => {
  const r = render.value;
  if (r.kind === "bash") return r.command;
  if (r.kind === "edit" || r.kind === "write" || r.kind === "read")
    return r.filePath;
  return JSON.stringify(r.raw, null, 2);
});

const suggestions = computed<PermissionUpdateEntry[]>(
  () => props.request.permissionSuggestions,
);

const buttonRefs = ref<Array<HTMLButtonElement | null>>([]);

function setButtonRef(el: Element | ComponentPublicInstance | null, i: number) {
  if (el instanceof HTMLButtonElement) {
    buttonRefs.value[i] = el;
  }
}

const totalButtons = computed(
  () => 1 + suggestions.value.length + 1, // Allow once + N suggestions + Deny
);

function focusIndex(i: number) {
  buttonRefs.value[i]?.focus();
}

function allowOnce() {
  emit("allow");
}

function allowWithSuggestion(s: PermissionUpdateEntry) {
  emit("allow", [s]);
}

function deny() {
  emit("deny");
}

function onKeydown(e: KeyboardEvent, i: number) {
  // Up/Down navigate between buttons. Enter is handled natively by
  // <button>. Esc triggers deny.
  if (e.key === "ArrowDown" && i < totalButtons.value - 1) {
    e.preventDefault();
    focusIndex(i + 1);
  } else if (e.key === "ArrowUp" && i > 0) {
    e.preventDefault();
    focusIndex(i - 1);
  } else if (e.key === "Escape") {
    e.preventDefault();
    deny();
  }
}

// Focus first button ("Allow once") on mount / when request changes
watch(
  () => props.request.requestId,
  () => {
    nextTick(() => focusIndex(0));
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-1 p-3 text-[13px] select-none w-full">
    <!-- Mono block preview (Bash command / file path / JSON fallback) -->
    <pre class="font-mono text-[11px] text-[var(--foreground)] bg-[var(--hover-island)] rounded-md p-2 mb-1 whitespace-pre-wrap break-words max-h-[200px] overflow-auto">{{ preview }}</pre>

    <!-- Plain text button list -->
    <button
      :ref="el => setButtonRef(el, 0)"
      type="button"
      class="text-left text-[12px] text-[var(--allow)] bg-transparent border-0 p-1 px-2 rounded cursor-pointer hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)] focus:bg-[var(--hover-island)]"
      @click="allowOnce"
      @keydown="onKeydown($event, 0)"
    >
      Allow once
    </button>

    <button
      v-for="(s, i) in suggestions"
      :key="i"
      :ref="el => setButtonRef(el, i + 1)"
      type="button"
      class="text-left text-[12px] text-[var(--allow)] bg-transparent border-0 p-1 px-2 rounded cursor-pointer hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)] focus:bg-[var(--hover-island)]"
      @click="allowWithSuggestion(s)"
      @keydown="onKeydown($event, i + 1)"
    >
      {{ suggestionLabel(s, lang) }}
    </button>

    <button
      :ref="el => setButtonRef(el, 1 + suggestions.length)"
      type="button"
      class="text-left text-[12px] text-[var(--deny)] bg-transparent border-0 p-1 px-2 rounded cursor-pointer hover:bg-[var(--hover-island)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--island)] focus:bg-[var(--hover-island)]"
      @click="deny"
      @keydown="onKeydown($event, 1 + suggestions.length)"
    >
      Deny
    </button>
  </div>
</template>
