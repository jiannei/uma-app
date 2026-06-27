import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import unocss from "@unocss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
// PR-4: @tailwindcss/vite removed. UnoCSS is the sole CSS engine —
// theme + tokens come from uno.config.ts + shared.css, utility classes
// are emitted by the virtual:uno.css import in each entry.
export default defineConfig(async () => ({
  plugins: [vue(), unocss()],

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
