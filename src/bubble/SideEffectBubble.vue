<script setup lang="ts">
// src/bubble/SideEffectBubble.vue — SideEffect 展开态。
//
// v5：删 header（Claude Code wants permission + toolName tag）+ 底部
// Allow/Deny 按钮。决策在 pill。只渲染 tool_input 详情。

import type { SideEffectRequest } from "../types/permission";
import { formatDetail } from "./format-detail";

defineProps<{
  request: SideEffectRequest;
}>();

function detailLine(req: SideEffectRequest): string {
  return formatDetail(req.toolName, req.toolInput);
}
</script>

<template>
  <div class="expanded-shell flex flex-col gap-2 p-3 text-[13px] select-none w-full">
    <div
      v-if="detailLine(request)"
      class="text-foreground font-mono text-[11px] p-2 rounded-md max-h-[200px] overflow-auto whitespace-pre-wrap break-words"
    >
      {{ detailLine(request) }}
    </div>
  </div>
</template>
