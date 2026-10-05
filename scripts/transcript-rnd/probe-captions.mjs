#!/usr/bin/env node
/**
 * Caption-render + PO-token probe.
 * - Does the caption track activate and render DOM text?
 * - What does getOption('captions','track') report?
 * - Capture every request URL mentioning timedtext/pot (names only) and any
 *   timedtext response body.
 * - Re-read getPlayerResponse after playback to see if baseUrl gains a pot.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const id = process.argv[2] || "aircAruvnKk";

const headless = process.env.HEADLESS !== "0";
const userDataDir = process.env.USER_DATA_DIR || undefined;
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless,
  userDataDir,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--lang=en-US",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
});

try {
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );
  const client = await page.target().createCDPSession();
  await client.send("Network.enable", { maxTotalBufferSize: 200_000_000, maxResourceBufferSize: 80_000_000 });

  const reqs = new Map();
  client.on("Network.requestWillBeSent", (e) => {
    const u = e.request.url;
    if (/timedtext|pot=|po_token|\/api\/timedtext/i.test(u)) {
      let names = [];
      try { names = [...new URL(u).searchParams.keys()]; } catch {}
      reqs.set(e.requestId, { url: u, names });
    }
  });
  client.on("Network.responseReceived", (e) => {
    const m = reqs.get(e.requestId);
    if (m) { m.status = e.response.status; m.mimeType = e.response.mimeType; }
  });

  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const setup = await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    let track = null, tracklist = [];
    try { track = p?.getOption?.("captions", "track"); } catch {}
    try { tracklist = p?.getOption?.("captions", "tracklist") || []; } catch {}
    try { p?.setOption?.("captions", "track", { languageCode: "en" }); } catch {}
    document.querySelector(".ytp-subtitles-button")?.click?.();
    try { p?.playVideo?.(); } catch {}
    return { track, tracklistCount: tracklist.length };
  });

  // watch captions for up to 20s
  const samples = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll(".ytp-caption-segment")).map((n) => n.textContent?.trim()).filter(Boolean);
      const v = document.querySelector("video");
      return { t: v?.currentTime ?? null, segs };
    });
    samples.push(s);
  }

  const after = await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return {
      track: (() => { try { return p?.getOption?.("captions", "track"); } catch { return null; } })(),
      firstBaseUrlParams: tracks[0]?.baseUrl ? [...new URL(tracks[0].baseUrl).searchParams.keys()] : [],
    };
  });

  const bodies = [];
  for (const [rid, m] of reqs) {
    let body = { error: "none" };
    try {
      const b = await client.send("Network.getResponseBody", { requestId: rid });
      const text = b.base64Encoded ? Buffer.from(b.body, "base64").toString("utf8") : b.body;
      body = { bytes: text.length, head: text.slice(0, 50) };
    } catch (e) { body = { error: String(e).slice(0, 60) }; }
    bodies.push({ names: m.names, status: m.status, mimeType: m.mimeType, body });
  }

  console.log(JSON.stringify({ id, setup, after, captionSamples: samples, captionRequests: bodies }, null, 2));
} finally {
  await browser.close();
}
