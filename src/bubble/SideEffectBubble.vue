<script setup lang="ts">
// src/bubble/SideEffectBubble.vue — SideEffect kind 展开态。
//
// ADR-0013 架构：原本是顶层 dispatcher（监听 `permission-request`
// + 按 kind 路由），现在拆成"展开态"——BubbleApp 持有 request 状态，
// view='expanded' 时按 kind 渲染对应 SFC，决策通过 `decide` 事件
// 通知父级统一 invoke respond_permission + 管理 fade-out。
//
// 渲染：BubbleHeader + tool_input 详情 + permission_suggestions
// + Allow / Deny。固定宽 480pt，长内容走内部 ScrollArea（ADR-0013
// 决策 14）。

import { ref } from "vue";
import { Shield } from "@lucide/vue";
import type {
  PermissionDecision,
  PermissionUpdateEntry,
  SideEffectRequest,
} from "../types/permission";
import { bubbleText } from "./strings";
import { formatDetail } from "./format-detail";
import { suggestionLabel } from "./suggestion-label";
import { useBubbleLang } from "./lang";
import { Button } from "@/components/ui/button";
import BubbleHeader from "@/components/bubble/BubbleHeader.vue";

const lang = useBubbleLang(); // reactive — updated by set_language

const props = defineProps<{
  request: SideEffectRequest;
}>();

const emit = defineEmits<{
  decide: [decision: PermissionDecision];
}>();

const sending = ref(false);

function emitDecide(decision: PermissionDecision) {
  if (sending.value) return;
  sending.value = true;
  emit("decide", decision);
}

function allow() {
  emitDecide({ requestId: props.request.requestId, behavior: "allow" });
}

function deny() {
  emitDecide({ requestId: props.request.requestId, behavior: "deny" });
}

function pickSuggestion(entry: PermissionUpdateEntry) {
  emitDecide({
    requestId: props.request.requestId,
    behavior: "allow",
    updatedPermissions: [entry],
  });
}

// Per-tool tool_input one-liner.
function detailLine(): string {
  return formatDetail(props.request.toolName, props.request.toolInput);
}
</script>

<template>
  <!--
    SideEffect 展开态：固定 480 宽，顶部居中（不 h-full）。
    高度 auto 装内容；超长用内部 overflow-auto 滚动。
    底部留空区域自动 click-through（webview body pointer-events-none）。
  -->
  <div class="expanded-shell flex flex-col gap-2 p-3 text-[13px] select-none w-full max-h-[360px] overflow-y-auto">
    <BubbleHeader
      :icon="Shield"
      variant="destructive"
      :title="`${request.agentDisplayName} wants permission`"
      :tag="request.toolName"
    />

    <div
      v-if="detailLine()"
      class="bg-muted text-muted-foreground font-mono text-[11px] p-2 rounded-md max-h-[80px] overflow-auto whitespace-pre-wrap break-words"
    >
      {{ detailLine() }}
    </div>

    <div
      v-if="request.permissionSuggestions?.length"
      class="flex flex-col gap-1 suggestions-scroll"
    >
      <Button
        v-for="(entry, i) in request.permissionSuggestions"
        :key="i"
        variant="outline"
        class="w-full justify-center"
        :disabled="sending"
        @click="pickSuggestion(entry)"
      >
        {{ suggestionLabel(entry, lang) }}
      </Button>
    </div>

    <div class="flex gap-1.5 mt-auto">
      <Button
        variant="default"
        class="flex-1"
        :disabled="sending"
        @click="allow"
      >
        {{ bubbleText(lang, "allow") }}
      </Button>
      <Button
        variant="destructive"
        class="flex-1"
        :disabled="sending"
        @click="deny"
      >
        {{ bubbleText(lang, "deny") }}
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* .expanded-shell 共享样式在 src/styles/bubble.css（ADR-0013 Y1）。
   这里只放 SideEffect 特有样式。 */

.suggestions-scroll {
  max-height: 110px;
  overflow-y: auto;
}
</style>
