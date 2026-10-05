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
      entry: fileURLToPath(new URL("src/background.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "background.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "background.js",
        chunkFileNames: "chunks/[name].js",
      },
    },
  },
});
