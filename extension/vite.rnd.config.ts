import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Isolated build for the transcript R&D harness. Does not touch the production
 * bundles; outputs the debug page to `dist/rnd/`.
 */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("dist/rnd", import.meta.url)),
    emptyOutDir: true,
    target: "chrome120",
    rollupOptions: {
      input: fileURLToPath(new URL("src/transcript-rnd/debug.html", import.meta.url)),
    },
  },
});
