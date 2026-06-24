// src/devtools/main.ts — DevTools webview entry. Mounts the Vue app
// that hosts the 4 diagnostic panels + Reset button. See
// docs/adr/0005-dev-tools.md for design rationale.

import { createApp } from "vue";
import DevToolsApp from "./DevToolsApp.vue";

createApp(DevToolsApp).mount("#app");
