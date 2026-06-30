// src/bubble/main.ts — Vue entry for the bubble webview.
//
// ADR-0013 + spec 2026-06-30: mounts BubbleShellRoot (new dispatcher)
// instead of BubbleApp. BubbleShellRoot manages idle / pill / panel
// states, rendering PillShell (SideEffect) or PanelShell (Elicitation /
// PlanReview).
//
// `initBubbleLang()` is called before mount so all bubble
// components share a single reactive `lang` ref driven by
// `set_language` (App.vue settings).

import { createApp } from "vue";
import BubbleShellRoot from "./BubbleShellRoot.vue";
import { initBubbleLang } from "./lang";
// presetWind4 ships its own Tailwind v4-aligned reset (no separate @unocss/reset
// needed). UnoCSS utilities override the reset on conflict.
import "virtual:uno.css";
import "../styles/bubble.css";

initBubbleLang().finally(() => {
  createApp(BubbleShellRoot).mount("#app");
});
