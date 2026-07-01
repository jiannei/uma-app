import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// Tailwind v4 (CSS-first config: @theme / @utility / @plugin in
// src/styles/shared.css). Iconify for i-lucide-* is loaded via
// @plugin "@iconify/tailwind4" in shared.css (Task 2).
export default defineConfig(async () => ({
  plugins: [
    vue(),
    tailwindcss(),
    VueI18nPlugin({
      include: resolve(__dirname, "src/i18n/locales/*.json"),
    }),
  ],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        // Suppress @vueuse/core INVALID_ANNOTATION warnings (third-party library issue)
        if (warning.code === 'INVALID_ANNOTATION' && warning.message?.includes('@vueuse/core')) {
          return
        }
        warn(warning)
      },
      input: {
        main: "index.html",
        robot: "robot.html",
        "bubble": "bubble.html",
        // Three entries: settings (main), robot sprite, permission bubble.
        // DevTools used to be a 4th entry (see ADR-0005) — it is now
        // embedded inside the main window as a sidebar nav item, gated
        // by `import.meta.env.DEV` in App.vue.
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
