import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: fileURLToPath(new URL("src/content.ts", import.meta.url)),
      formats: ["iife"],
      name: "YouTubeAIReader",
      fileName: () => "content.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "content.js",
        inlineDynamicImports: true,
      },
    },
  },
});
