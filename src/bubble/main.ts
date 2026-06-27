// src/bubble/main.ts — Vue entry for the bubble webview.
//
// ADR-0013 架构：mounts BubbleApp（顶层 dispatcher）to `#app`.
// BubbleApp 监听 `permission-request` Tauri 事件，管理 idle / pill /
// expanded 状态机，渲染 PillBubble 或按 kind 派发到
// ToolBubble / AskBubble / PlanBubble。
//
// `initBubbleLang()` is called before mount so all bubble
// components share a single reactive `lang` ref driven by
// `set_language` (App.vue settings).

import { createApp } from "vue";
import BubbleApp from "./BubbleApp.vue";
import { initBubbleLang } from "./lang";
// presetWind4 ships its own Tailwind v4-aligned reset (no separate @unocss/reset
// needed). UnoCSS utilities override the reset on conflict.
import "virtual:uno.css";
import "../styles/bubble.css";

initBubbleLang().finally(() => {
  createApp(BubbleApp).mount("#app");
});
