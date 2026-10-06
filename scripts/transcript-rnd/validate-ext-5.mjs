#!/usr/bin/env node
/**
 * Validate the REAL production browser path against N videos: load the built
 * extension, open each YouTube watch page, and drive the same message the side
 * panel uses (EXTRACT_CLIENT_TRANSCRIPT). A pass means the extension would use
 * the browser transcript instead of falling back to the (IP-blocked) server.
 *
 *   VIDEO=id1,id2,id3 node scripts/transcript-rnd/validate-ext-5.mjs
 */
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const dist = fileURLToPath(new URL("../../extension/dist", import.meta.url));
if (!existsSync(dist)) {
  console.error("extension/dist not found — run `npm run build` in extension/");
  process.exit(1);
}

const ids = (process.env.VIDEO ? process.env.VIDEO.split(",") : process.argv.slice(2)).filter(Boolean);
const videos = ids.length
  ? ids
  : ["_j806JHhCRo", "aircAruvnKk", "dQw4w9WgXcQ", "9bZkp7q19f0", "JGwWNGJdvx8"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADLESS === "1",
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-ext-5",
  args: [
    "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
  ],
});

const results = [];
try {
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
    { timeout: 15000 },
  );
  const extId = swTarget.url().split("/")[2];
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" }).catch(() => {});

  for (const id of videos) {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    try {
      await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await sleep(1000);
      await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});
      // Give the player a moment to have captions available.
      await sleep(2500);

      const res = await extPage.evaluate(async (videoId) => {
        const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*"] });
        const yt = tabs.find((t) => (t.url || "").includes(`watch?v=${videoId}`));
        if (!yt?.id) return { error: "no youtube tab", tabs: tabs.map((t) => t.url) };
        const r = await chrome.runtime.sendMessage({
          type: "EXTRACT_CLIENT_TRANSCRIPT",
          videoId,
          tabId: yt.id,
        });
        return {
          status: r?.status,
          method: r?.payload?.method,
          format: r?.payload?.format,
          contentLen: r?.payload?.content?.length ?? null,
          segments: r?.payload?.segments?.length ?? null,
          error: r?.error ?? r?.message ?? null,
        };
      }, id);

      const ok = res.status === "ok" && (res.contentLen || res.segments);
      results.push({ id, ok: Boolean(ok), ...res });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      results.push({ id, ok: false, error: String(error).slice(0, 140) });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULT: ${ok}/${results.length} videos read via the browser (production path)`);
if (ok !== results.length) process.exitCode = 1;
