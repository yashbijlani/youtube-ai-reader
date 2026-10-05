#!/usr/bin/env node
/**
 * Validate the FIXED browser capture against 5 real videos, using the exact
 * production functions: pageInterceptor + triggerCaptionRequest + readPageCaptures.
 * Mirrors BrowserTranscriptProvider.extract (including retriggers) so a pass here
 * means the production path will use browser_intercept, not server yt-dlp.
 */
import puppeteer from "puppeteer-core";
import { pageInterceptor } from "../../extension/src/transcript-rnd/page-interceptor.ts";
import { triggerCaptionRequest } from "../../extension/src/transcript-rnd/methods.ts";
import { parseJson3, normalizeSegments } from "../../extension/src/transcript-rnd/parseJson3.ts";

// Identical to BrowserTranscriptProvider.readPageCaptures (inlined because the
// production module uses extensionless imports that plain Node ESM can't resolve).
const readPageCaptures = () => {
  const caps = (window.__yairCaptured || []).filter((c) => c && c.bytes > 0 && c.bytes <= 8000000);
  caps.sort((a, b) => b.bytes - a.bytes);
  return caps[0] || null;
};

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const ids = process.argv.slice(2);
const videos = ids.length
  ? ids
  : ["aircAruvnKk", "dQw4w9WgXcQ", "9bZkp7q19f0", "JGwWNGJdvx8", "RgKAFK5djSk"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: process.env.HEADLESS === "1",
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-stealth",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--lang=en-US",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
  ],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

try {
  for (const id of videos) {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    });
    // Mirror production: interceptor installed at document_start (MAIN world).
    await page.evaluateOnNewDocument(pageInterceptor, { token: `v-${id}`, source: "yair-rnd", patchFetch: true });
    try {
      await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
      await sleep(1200);
      await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page
        .waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 })
        .catch(() => {});

      const started = Date.now();
      let capture = null;
      let best = null;
      let bestBytes = 0;
      let lastTimestamp = 0;
      const duration = await page.evaluate(() => {
        const v = document.querySelector("video");
        return v && Number.isFinite(v.duration) ? v.duration : 0;
      });
      await page.evaluate(triggerCaptionRequest, "en");
      let nextRetrigger = started + 6000;
      let retriggers = 0;
      let graceUntil = 0;
      const deadline = started + 25000;
      while (Date.now() < deadline) {
        capture = await page.evaluate(readPageCaptures);
        if (capture?.bytes) {
          if (capture.bytes > bestBytes) {
            bestBytes = capture.bytes;
            best = capture;
            const segs = normalizeSegments(parseJson3(capture.text));
            lastTimestamp = segs.length ? segs[segs.length - 1].start : 0;
            graceUntil = Date.now() + 8000;
          }
          const complete = duration > 0 && lastTimestamp >= duration * 0.9;
          if (complete || Date.now() >= graceUntil) break;
        } else if (Date.now() >= nextRetrigger && retriggers < 3) {
          retriggers += 1;
          nextRetrigger = Date.now() + 6000;
          await page.evaluate(triggerCaptionRequest, "en").catch(() => null);
        }
        await sleep(400);
      }
      capture = best;

      const latencyMs = Date.now() - started;
      if (capture?.bytes) {
        const segments = normalizeSegments(parseJson3(capture.text));
        const row = {
          id,
          ok: segments.length > 0,
          via: capture.via,
          hasPot: capture.hasPot,
          bytes: capture.bytes,
          segments: segments.length,
          first: segments[0]?.start ?? null,
          last: segments.at(-1)?.start ?? null,
          latencyMs,
        };
        results.push(row);
        console.log(JSON.stringify(row));
      } else {
        results.push({ id, ok: false, error: "no capture" });
        console.log(JSON.stringify(results.at(-1)));
      }
    } catch (error) {
      results.push({ id, ok: false, error: String(error).slice(0, 120) });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}

const ok = results.filter((r) => r.ok).length;
console.log(`\nRESULT: ${ok}/${results.length} captured via browser interception`);
if (ok !== results.length) process.exitCode = 1;
