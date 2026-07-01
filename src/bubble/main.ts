// src/bubble/main.ts — Vue entry for the bubble webview.
//
// ADR-0013 + spec 2026-06-30: mounts BubbleShellRoot (new dispatcher)
// instead of BubbleApp. BubbleShellRoot manages idle / pill / panel
// states, rendering PillShell (SideEffect) or PanelShell (Elicitation /
// PlanReview).
//
// Language flows through `useSettings()` — each component that needs
// the current language calls the composable itself; no init dance
// needed before mount. (The pre-redesign `initBubbleLang()` /
// `lang.ts` singleton was an orphan after the bubble redesign — no
// component consumed the singleton's reactive ref. Settings
// ownership deepening deletes it.)

import { createApp } from "vue";
import BubbleShellRoot from "./BubbleShellRoot.vue";
import { i18n } from "@/i18n";
import "../styles/shared.css";
import "../styles/shortcuts.css";
import "../styles/bubble.css";

const app = createApp(BubbleShellRoot);
app.use(i18n);
app.mount("#app");
