import { defineConfig } from "vitest/config";

// No react plugin here on purpose: vitest transforms TSX via esbuild, and
// @vitejs/plugin-react binds to the top-level vite 6 types while vitest 2
// bundles vite 5 types — importing both in one file cannot typecheck.
export default defineConfig({
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
