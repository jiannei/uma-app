import { createApp } from "vue";
import App from "./App.vue";
// presetWind4 ships its own Tailwind v4-aligned reset (no separate @unocss/reset
// needed). UnoCSS utilities override the reset on conflict.
import "virtual:uno.css";
import "./styles/main.css";

createApp(App).mount("#app");
