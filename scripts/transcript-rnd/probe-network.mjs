#!/usr/bin/env node
/**
 * Method C deep-dive: capture YouTube's OWN caption request/response with raw
 * CDP (request param NAMES only, never values), retrieve response bodies via
 * Network.getResponseBody, and inspect the transcript-panel InnerTube endpoint.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["aircAruvnKk"];

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

const paramNames = (u) => {
  try {
    return [...new URL(u).searchParams.keys()];
  } catch {
    return [];
  }
};

try {
  for (const id of targets) {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    const client = await page.target().createCDPSession();
    await client.send("Network.enable", { maxTotalBufferSize: 100_000_000, maxResourceBufferSize: 50_000_000 });

    const interesting = new Map(); // requestId -> meta
    client.on("Network.requestWillBeSent", (e) => {
      const u = e.request.url;
      if (/timedtext/i.test(u)) {
        interesting.set(e.requestId, {
          urlParams: paramNames(u),
          host: (() => { try { return new URL(u).host; } catch { return "?"; } })(),
          method: e.request.method,
          headerNames: Object.keys(e.request.headers || {}),
          postDataBytes: e.request.postData ? e.request.postData.length : 0,
        });
      }
    });
    client.on("Network.responseReceived", (e) => {
      const meta = interesting.get(e.requestId);
      if (meta) {
        meta.status = e.response.status;
        meta.mimeType = e.response.mimeType;
        meta.fromDiskCache = e.response.fromDiskCache;
      }
    });

    await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

    // Enable captions through the actual CC control, then play.
    await page.evaluate(() => {
      const cc = document.querySelector(".ytp-subtitles-button");
      cc?.click?.();
      const p = document.querySelector("#movie_player");
      try {
        p?.playVideo?.();
      } catch {}
    });
    await new Promise((r) => setTimeout(r, 10000));

    const bodies = {};
    for (const requestId of interesting.keys()) {
      try {
        const b = await client.send("Network.getResponseBody", { requestId });
        const text = b.base64Encoded ? Buffer.from(b.body, "base64").toString("utf8") : b.body;
        bodies[requestId] = { bytes: text.length, head: text.slice(0, 80) };
      } catch (e) {
        bodies[requestId] = { error: String(e).slice(0, 80) };
      }
    }

    const requests = [...interesting.entries()].map(([rid, meta]) => ({ ...meta, body: bodies[rid] }));

    // Inspect the transcript panel endpoint params from ytInitialData.
    const panelEndpoint = await page.evaluate(() => {
      const d = window.ytInitialData;
      if (!d) return { found: false };
      const panels = d.engagementPanels || (d.playerOverlays?.playerOverlayRenderer?.engagementPanels) || [];
      const flat = JSON.stringify(panels);
      const hasTranscript = /transcript/i.test(flat);
      // pull the getTranscriptEndpoint params safely
      let params = null;
      const walk = (o) => {
        if (!o || typeof o !== "object" || params) return;
        for (const k of Object.keys(o)) {
          if (k === "getTranscriptEndpoint" && o[k]?.params) { params = { found: true, paramsLen: o[k].params.length }; return; }
          walk(o[k]);
        }
      };
      walk(d);
      return { found: hasTranscript, params };
    });

    console.log(JSON.stringify({ id, requests, panelEndpoint }, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
}
