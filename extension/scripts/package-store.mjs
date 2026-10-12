#!/usr/bin/env node
/**
 * Produces a Chrome Web Store-ready package from `dist/`.
 *
 *   node scripts/build.mjs && node scripts/package-store.mjs   (or: npm run package)
 *
 * Differences from the dev build:
 *   - drops localhost/127.0.0.1 host permissions (unused in production and
 *     flagged by reviewers);
 *   - removes the `key` field (only valid for unpacked local dev; the Web Store
 *     rejects packages that contain it);
 *   - writes the sanitized manifest into a clean `store/` copy of `dist/`;
 *   - zips it as `store/youtube-ai-reader-<version>.zip` (manifest at the root).
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dist = join(root, "dist");
const store = join(root, "store");

const DEV_HOST_PERMISSIONS = new Set(["http://localhost/*", "http://127.0.0.1/*"]);

if (!existsSync(dist)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
manifest.host_permissions = (manifest.host_permissions ?? []).filter(
  (host) => !DEV_HOST_PERMISSIONS.has(host),
);
delete manifest.key;

rmSync(store, { recursive: true, force: true });
mkdirSync(store, { recursive: true });
cpSync(dist, store, { recursive: true });
writeFileSync(join(store, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const zipName = `youtube-ai-reader-${manifest.version}.zip`;
const zipPath = join(store, zipName);
const zip = spawnSync("zip", ["-r", "-q", zipPath, ".", "-x", zipName], {
  cwd: store,
  stdio: "inherit",
});
if (zip.status !== 0) {
  console.error("zip failed (is the `zip` binary installed?)");
  process.exit(zip.status ?? 1);
}

console.log(`\nStore package: ${zipPath}`);
console.log(`Host permissions: ${manifest.host_permissions.join(", ")}`);
