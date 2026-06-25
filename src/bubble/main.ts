// src/bubble/main.ts — Vue entry for the permission-bubble webview.
//
// Mounts SideEffectBubble to `#app`. The component listens for
// `permission-request` Tauri events and renders the request
// payload, dispatching by kind to ElicitationBubble /
// PlanReviewBubble.
//
// `initBubbleLang()` is called before mount so all 3 bubble
// components share a single reactive `lang` ref driven by
// `set_language` (App.vue settings).

import { createApp } from "vue";
import SideEffectBubble from "./SideEffectBubble.vue";
import { initBubbleLang } from "./lang";

initBubbleLang().finally(() => {
  createApp(SideEffectBubble).mount("#app");
});
