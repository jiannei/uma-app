// vitest.config.ts — minimal vitest config; pure.ts / registry tests run
// in happy-dom (same env as component tests). Component snapshot tests
// (StoresPanel / PillShell / ToolPillContent) mount with @vue/test-utils
// via the `@vitejs/plugin-vue` plugin below.
//
// Component test files live alongside the components they cover and
// match `src/**/*.test.ts`.

import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  test: {
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
  },
});