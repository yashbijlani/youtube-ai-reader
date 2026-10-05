#!/usr/bin/env node
/**
 * Extension E2E: load the built extension in Chromium and verify the
 * document_start MAIN-world interceptor actually populates `window.__yairCaptured`
 * on a real YouTube page. This reproduces the extension runtime path (unlike the
 * R&D harness which injects manually).
 */
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const dist = fileURLToPath(new URL("../../extension/dist", import.meta.url));
if (!existsSync(dist)) {
  console.error("extension/dist not found — run `npm run build` first");
  process.exit(1);
}
const id = process.argv[2] || "aircAruvnKk";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-ext-e2e",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
  ],
});

try {
  // Confirm the extension's service worker loaded.
  let swTarget = null;
  try {
    swTarget = await browser.waitForTarget(
      (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
      { timeout: 15000 },
    );
  } catch {
    /* may not appear; continue */
  }
  console.log("service worker:", swTarget ? swTarget.url() : "NOT FOUND");

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  // Did the document_start content script install the interceptor in MAIN world?
  const installed = await page.evaluate(() => Boolean(window.__yairInterceptorInstalled));
  // Nudge the player to fetch captions (as the app does), then read the buffer.
  await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    try { p?.setOption?.("captions", "track", { languageCode: "en" }); } catch {}
    document.querySelector(".ytp-subtitles-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    try { p?.playVideo?.(); } catch {}
  });

  let captures = [];
  for (let i = 0; i < 30; i += 1) {
    captures = await page.evaluate(() =>
      (window.__yairCaptured || []).map((c) => ({ bytes: c.bytes, hasPot: c.hasPot, via: c.via })),
    );
    if (captures.some((c) => c.bytes > 0)) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("interceptorInstalled:", installed);
  console.log("captures:", JSON.stringify(captures));

  // Verify the provider's exact read path: chrome.scripting.executeScript from SW.
  if (swTarget) {
    try {
      const worker = await swTarget.worker();
      const read = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { error: "no active tab" };
        const res = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: () => (window.__yairCaptured || []).map((c) => c.bytes),
        });
        return { tabId: tab.id, bytes: res?.[0]?.result ?? null };
      });
      console.log("SW executeScript read:", JSON.stringify(read));
    } catch (error) {
      console.log("SW executeScript read error:", String(error).slice(0, 140));
    }
  }

  const ok = installed && captures.some((c) => c.bytes > 0);
  console.log(ok ? "RESULT: capture OK" : "RESULT: capture FAILED");
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
