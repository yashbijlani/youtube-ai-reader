#!/usr/bin/env node
/**
 * Comprehensive stealth-representative probe: methods A (player-response fetch),
 * C (observe player's own caption response body), D (rendered caption DOM),
 * F (native transcript panel endpoint), E (page globals inventory).
 *
 * Emulates the production environment: a real user's browser session.
 * Never logs cookie/token values.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const id = process.argv[2] || "aircAruvnKk";
const headless = process.env.HEADLESS === "1";
const lang = process.env.TRACK_LANG || "en";

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

const countSegs = (json3) => {
  try {
    const d = JSON.parse(json3);
    return (d.events || []).filter((e) => e.segs?.length).length;
  } catch {
    return -1;
  }
};

const t0 = Date.now();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    window.chrome = window.chrome || { runtime: {} };
  });

  const client = await page.target().createCDPSession();
  await client.send("Network.enable", { maxTotalBufferSize: 300_000_000, maxResourceBufferSize: 120_000_000 });
  const timedtext = new Map();
  client.on("Network.requestWillBeSent", (e) => {
    if (/timedtext/i.test(e.request.url)) {
      let names = [];
      try { names = [...new URL(e.request.url).searchParams.keys()]; } catch {}
      timedtext.set(e.requestId, { names, hasPot: names.includes("pot"), hasPotc: names.includes("potc") });
    }
  });

  // Warm-up
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  // ---- Method E: page globals inventory
  const methodE = await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    return {
      hasMoviePlayer: Boolean(p),
      hasYtInitialPlayerResponse: Boolean(window.ytInitialPlayerResponse),
      hasYtcfg: Boolean(window.ytcfg),
      trackCount: tracks.length,
      languages: tracks.map((t) => t.languageCode).slice(0, 8),
      manualCount: tracks.filter((t) => t.kind !== "asr").length,
      asrCount: tracks.filter((t) => t.kind === "asr").length,
      servableCount: tracks.filter((t) => t.isServable === true).length,
      servableUndefined: tracks.filter((t) => t.isServable === undefined).length,
      playability: pr?.playabilityStatus?.status,
    };
  });

  // ---- Method A: fetch the player-response baseUrl from page context
  const methodA = await page.evaluate(async (prefLang) => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick =
      tracks.find((t) => t.languageCode?.startsWith(prefLang) && t.kind !== "asr") ||
      tracks.find((t) => t.languageCode?.startsWith(prefLang)) ||
      tracks[0];
    if (!pick?.baseUrl) return { ok: false, error: "no-baseUrl" };
    const url = pick.baseUrl.includes("fmt=") ? pick.baseUrl : `${pick.baseUrl}&fmt=json3`;
    const started = performance.now();
    try {
      const r = await fetch(url, { credentials: "include" });
      const text = await r.text();
      return {
        ok: r.status === 200 && text.length > 0,
        status: r.status,
        bytes: text.length,
        contentType: r.headers.get("content-type"),
        segmentEvents: (() => { try { return (JSON.parse(text).events || []).filter((e) => e.segs?.length).length; } catch { return -1; } })(),
        latencyMs: Math.round(performance.now() - started),
        lang: pick.languageCode,
        kind: pick.kind ?? "manual",
        note: "no direct fetch: 0 bytes (pot required)",
      };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 120), lang: pick.languageCode };
    }
  }, lang);

  // ---- Turn on captions the way a user would, and play.
  await page.evaluate((prefLang) => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick = tracks.find((t) => t.languageCode?.startsWith(prefLang)) || tracks[0];
    try { p?.setOption("captions", "track", { languageCode: pick?.languageCode || prefLang }); } catch {}
    document.querySelector(".ytp-subtitles-button")?.click?.();
    try { p?.playVideo(); } catch {}
  }, lang);

  // ---- Method D: sample rendered caption DOM while playing.
  const domSegments = [];
  const seenText = new Set();
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const sample = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll(".ytp-caption-segment"))
        .map((n) => n.textContent?.trim())
        .filter(Boolean);
      const v = document.querySelector("video");
      return { t: v?.currentTime ?? 0, segs };
    });
    for (const s of sample.segs) {
      const key = `${Math.floor(sample.t)}|${s}`;
      if (!seenText.has(key)) { seenText.add(key); domSegments.push({ t: Math.round(sample.t * 10) / 10, text: s }); }
    }
  }

  // ---- Method C: retrieve bodies of the player's own timedtext requests.
  const network = [];
  for (const [rid, meta] of timedtext) {
    let body;
    try {
      const b = await client.send("Network.getResponseBody", { requestId: rid });
      const text = b.base64Encoded ? Buffer.from(b.body, "base64").toString("utf8") : b.body;
      body = { bytes: text.length, segmentEvents: countSegs(text), head: text.slice(0, 40) };
    } catch (e) {
      body = { error: String(e).slice(0, 70) };
    }
    network.push({ ...meta, body });
  }

  // ---- Method F: call get_transcript with page context + panel params.
  const methodF = await page.evaluate(async () => {
    const walk = (o) => {
      let found = null;
      const rec = (x) => {
        if (found || !x || typeof x !== "object") return;
        for (const k of Object.keys(x)) {
          if (k === "getTranscriptEndpoint" && x[k]?.params) { found = x[k].params; return; }
          rec(x[k]);
        }
      };
      rec(o);
      return found;
    };
    const params = walk(window.ytInitialData);
    if (!params) return { ok: false, error: "no-params" };
    const cfg = window.ytcfg;
    const get = (k) => (typeof cfg?.get === "function" ? cfg.get(k) : undefined);
    const apiKey = get("INNERTUBE_API_KEY");
    const context = get("INNERTUBE_CONTEXT");
    try {
      const r = await fetch(`/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey || "")}&prettyPrint=false`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, params }),
        credentials: "include",
      });
      const text = await r.text();
      return { ok: r.status === 200, status: r.status, bytes: text.length, segments: (text.match(/"transcriptSegmentRenderer"/g) || []).length, errorHead: r.status === 200 ? null : text.slice(0, 120) };
    } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
  });

  console.log(
    JSON.stringify(
      { id, lang, totalMs: Date.now() - t0, methodE, methodA, methodC: network, methodD: { distinctSegments: domSegments.length, sample: domSegments.slice(0, 6) }, methodF },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
