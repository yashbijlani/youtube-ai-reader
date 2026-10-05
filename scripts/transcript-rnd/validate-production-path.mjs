#!/usr/bin/env node
/**
 * Validate the *production* integration functions (the exact modules imported by
 * background.ts) end-to-end against a real video:
 *   pageInterceptor + triggerCaptionRequest + READ_CAPTURED
 * This is the same sequence chrome.scripting.executeScript performs.
 */
import puppeteer from "puppeteer-core";
import { pageInterceptor } from "../../extension/src/transcript-rnd/page-interceptor.ts";
import { triggerCaptionRequest } from "../../extension/src/transcript-rnd/methods.ts";
import { parseJson3, normalizeSegments, summarize } from "../../extension/src/transcript-rnd/parseJson3.ts";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const id = process.argv[2] || "aircAruvnKk";

const READ_CAPTURED = () => {
  const caps = (window.__yairCaptured || []).filter((c) => c && c.bytes > 0);
  caps.sort((a, b) => b.bytes - a.bytes);
  return caps[0]?.text ?? null;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADLESS === "1",
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-stealth",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--disable-blink-features=AutomationControlled"],
});
try {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");
  await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const t0 = Date.now();
  await page.evaluate(pageInterceptor, { token: "prod", source: "yair-rnd", patchFetch: true });
  const info = await page.evaluate(triggerCaptionRequest, "en");

  let text = null;
  for (let i = 0; i < 40 && !text; i += 1) {
    text = await page.evaluate(READ_CAPTURED);
    if (!text) await new Promise((r) => setTimeout(r, 500));
  }
  const latency = Date.now() - t0;
  if (!text) {
    console.log(JSON.stringify({ id, success: false, error: "no capture", tracks: info }, null, 2));
  } else {
    const summary = summarize(normalizeSegments(parseJson3(text)));
    console.log(JSON.stringify({ id, success: true, latencyMs: latency, tracks: info, summary, first: normalizeSegments(parseJson3(text))[0] }, null, 2));
  }
} finally {
  await browser.close();
}
