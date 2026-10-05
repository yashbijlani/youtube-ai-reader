import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Builds the document_start MAIN-world caption interceptor. */
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    emptyOutDir: false,
    target: "chrome120",
    lib: {
      entry: fileURLToPath(new URL("src/interceptor.ts", import.meta.url)),
      formats: ["iife"],
      name: "YouTubeAIReaderInterceptor",
      fileName: () => "interceptor.js",
    },
    rollupOptions: {
      output: {
        entryFileNames: "interceptor.js",
        inlineDynamicImports: true,
      },
    },
  },
});
