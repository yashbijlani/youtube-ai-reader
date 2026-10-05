#!/usr/bin/env node
/**
 * Stealth-representative browser probe. Production runs in a REAL user browser,
 * so we remove automation fingerprints and warm up a persistent profile before
 * loading the video. Measures whether captions become servable/rendered.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const id = process.argv[2] || "aircAruvnKk";
const headless = process.env.HEADLESS === "1";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless,
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-stealth",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--lang=en-US",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,900",
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = window.chrome || { runtime: {} };
  });

  // Warm-up: homepage first so consent + visitor cookies settle.
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));

  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const before = await page.evaluate(() => {
    const pr = window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return {
      webdriver: navigator.webdriver,
      playability: pr?.playabilityStatus?.status,
      trackCount: tracks.length,
      firstTrack: tracks[0]
        ? { lang: tracks[0].languageCode, isServable: tracks[0].isServable, kind: tracks[0].kind }
        : null,
    };
  });

  await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    try { p?.setOption("captions", "track", { languageCode: "en" }); } catch {}
    try { p?.playVideo(); } catch {}
  });

  const samples = [];
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    samples.push(
      await page.evaluate(() => {
        const segs = Array.from(document.querySelectorAll(".ytp-caption-segment"))
          .map((n) => n.textContent?.trim())
          .filter(Boolean);
        const v = document.querySelector("video");
        return { t: Math.round((v?.currentTime ?? 0) * 10) / 10, segs: segs.slice(0, 2) };
      }),
    );
  }

  const after = await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    let track = null;
    try { track = p?.getOption("captions", "track"); } catch {}
    return { track };
  });

  console.log(JSON.stringify({ id, before, after, samples }, null, 2));
} finally {
  await browser.close();
}
