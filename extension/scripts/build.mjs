#!/usr/bin/env node
/**
 * Builds all three extension bundles (side panel, background, content script)
 * and copies the manifest + icons into dist/.
 *
 *   node scripts/build.mjs            once
 *   node scripts/build.mjs --watch    rebuild on change
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");
const configs = ["vite.config.ts", "vite.background.config.ts", "vite.content.config.ts"];

function copyStatic() {
  mkdirSync(join(dist, "icons"), { recursive: true });
  cpSync(join(root, "public/manifest.json"), join(dist, "manifest.json"));
  cpSync(join(root, "public/icons"), join(dist, "icons"), { recursive: true });
}

function runOnce(config) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["vite", "build", "--config", config], {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  if (!existsSync(join(root, "public/manifest.json"))) {
    console.error("manifest.json missing");
    process.exit(1);
  }
  if (watch) {
    copyStatic();
    const children = configs.map((config) =>
      spawn("npx", ["vite", "build", "--watch", "--config", config], {
        cwd: root,
        stdio: "inherit",
        shell: false,
      }),
    );
    const shutdown = () => {
      for (const child of children) child.kill("SIGINT");
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    console.log("watching extension sources... (reload the extension in chrome://extensions)");
    return;
  }
  for (const config of configs) {
    const code = await runOnce(config);
    if (code !== 0) process.exit(code);
  }
  copyStatic();
  console.log("\nExtension built to extension/dist — load unpacked in chrome://extensions");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
