import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("src", import.meta.url)),
  // Load extension/.env (not src/.env) so VITE_* values are inlined into the
  // side panel bundle. Without this, root=src makes Vite read src/.env.
  envDir: root,
  base: "./",
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL("dist", import.meta.url)),
    emptyOutDir: true,
    target: "chrome120",
    rollupOptions: {
      input: fileURLToPath(new URL("src/sidepanel.html", import.meta.url)),
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
      "@shared": root,
    },
  },
});
