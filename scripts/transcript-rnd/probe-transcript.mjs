#!/usr/bin/env node
/**
 * Playback viability + transcript-panel InnerTube call.
 * 1. Does the video actually play (codecs) in this Chromium?
 * 2. Can we call /youtubei/v1/get_transcript with the page's own context + params?
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const id = process.argv[2] || "aircAruvnKk";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
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
  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const playback = await page.evaluate(async () => {
    const p = document.querySelector("#movie_player");
    const v = document.querySelector("video");
    try { p?.playVideo?.(); } catch {}
    await new Promise((r) => setTimeout(r, 4000));
    const canPlay = v ? v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"') : "no-video";
    return {
      hasVideoEl: Boolean(v),
      h264Support: canPlay,
      readyState: v?.readyState ?? null,
      currentTime: v?.currentTime ?? null,
      duration: v?.duration ?? null,
      paused: v?.paused ?? null,
      error: v?.error ? { code: v.error.code, message: v.error.message } : null,
    };
  });

  const transcript = await page.evaluate(async () => {
    const d = window.ytInitialData;
    let params = null;
    const walk = (o) => {
      if (!o || typeof o !== "object" || params) return;
      for (const k of Object.keys(o)) {
        if (k === "getTranscriptEndpoint" && o[k]?.params) { params = o[k].params; return; }
        walk(o[k]);
      }
    };
    walk(d);
    if (!params) return { ok: false, error: "no-params" };
    const cfg = window.ytcfg;
    const get = (k) => (typeof cfg?.get === "function" ? cfg.get(k) : undefined);
    const apiKey = get("INNERTUBE_API_KEY");
    const context = get("INNERTUBE_CONTEXT");
    const visitor = get("VISITOR_DATA");
    let res, body;
    try {
      res = await fetch(
        `/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey || "")}&prettyPrint=false`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(visitor ? { "X-Goog-Visitor-Id": String(visitor) } : {}),
          },
          body: JSON.stringify({ context, params }),
          credentials: "include",
        },
      );
      body = await res.text();
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 120), paramsLen: params.length, hasApiKey: Boolean(apiKey), hasContext: Boolean(context) };
    }
    const segmentCount = (body.match(/"transcriptSegmentRenderer"/g) || []).length;
    return {
      ok: res.status === 200,
      status: res.status,
      bytes: body.length,
      segmentCount,
      errorHead: res.status === 200 ? null : body.slice(0, 240),
      paramsLen: params.length,
      hasApiKey: Boolean(apiKey),
      hasContext: Boolean(context),
      hasVisitor: Boolean(visitor),
    };
  });

  console.log(JSON.stringify({ id, playback, transcript }, null, 2));
} finally {
  await browser.close();
}
