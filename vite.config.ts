import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [vue()],

  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        pet: "pet.html",
        "pet-bubble": "pet-bubble.html",
        // Dev-tools webview (see docs/adr/0005-dev-tools.md). The
        // Vite entry is always emitted; the runtime window is only
        // created when the Rust `dev-tools` feature is enabled.
        // In release builds the file exists in dist/ but is never
        // loaded — see plan §Phase C / §Phase G.
        devtools: "devtools.html",
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
