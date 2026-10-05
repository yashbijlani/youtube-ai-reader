/**
 * Shared browser helpers for the transcript R&D harness.
 *
 * Emulates the production environment (a real user's Chrome session) so that
 * browser-side measurements are representative. Never logs cookie/token values.
 */
import puppeteer from "puppeteer-core";
import { pageInterceptor } from "../../extension/src/transcript-rnd/page-interceptor.ts";

export const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
export const HEADLESS = process.env.HEADLESS === "1";
export const PROFILE = process.env.USER_DATA_DIR || "/tmp/opencode/chrome-stealth";

export const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: HEADLESS,
    userDataDir: PROFILE,
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
}

/** Stealth + caption-interceptor collector. Must be called before navigation. */
export async function preparePage(page, token = "rnd-token") {
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument(
    (cfg) => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
      window.chrome = window.chrome || { runtime: {} };
    },
    {},
  );
  // Production-shaped interceptor (postMessage), plus a collector mirroring the
  // content-script bridge validation.
  await page.evaluateOnNewDocument(pageInterceptor, { token, source: "yair-rnd" });
  await page.evaluateOnNewDocument(
    (t) => {
      window.__yairRnd = [];
      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== "yair-rnd" || data.token !== t || data.type !== "caption") return;
        window.__yairRnd.push({
          via: data.via,
          hasPot: data.hasPot,
          bytes: data.bytes,
          paramKeys: data.paramKeys,
          text: data.text,
        });
      });
    },
    token,
  );
}

export async function warmUp(page) {
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 1500));
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`;
}

/** Read caption-track metadata from the player response. */
export async function inspectVideo(page) {
  return page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const title = pr?.videoDetails?.title ?? null;
    const duration = pr?.videoDetails?.lengthSeconds ? Number(pr.videoDetails.lengthSeconds) : null;
    return {
      title,
      duration,
      playability: pr?.playabilityStatus?.status ?? null,
      playabilityReason: pr?.playabilityStatus?.reason ?? null,
      trackCount: tracks.length,
      manualCount: tracks.filter((t) => t.kind !== "asr").length,
      asrCount: tracks.filter((t) => t.kind === "asr").length,
      languages: tracks.map((t) => t.languageCode),
      englishManual: tracks.some((t) => String(t.languageCode || "").startsWith("en") && t.kind !== "asr"),
      englishAsr: tracks.some((t) => String(t.languageCode || "").startsWith("en") && t.kind === "asr"),
      captionTracklistAvailable: tracks.length > 0,
    };
  });
}

/** Method A: fetch the player-response caption baseUrl from the page context. */
export async function methodAPlayerFetch(page, prefLang = "en") {
  return page.evaluate(async (lang) => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick =
      tracks.find((t) => String(t.languageCode || "").startsWith(lang) && t.kind !== "asr") ||
      tracks.find((t) => String(t.languageCode || "").startsWith(lang)) ||
      tracks[0];
    if (!pick?.baseUrl) return { success: false, error: "no-baseUrl" };
    const url = pick.baseUrl.includes("fmt=") ? pick.baseUrl : `${pick.baseUrl}&fmt=json3`;
    const started = performance.now();
    try {
      const r = await fetch(url, { credentials: "include" });
      const text = await r.text();
      return {
        success: r.status === 200 && text.length > 0,
        status: r.status,
        bytes: text.length,
        latencyMs: Math.round(performance.now() - started),
        language: pick.languageCode ?? null,
        text,
        error: text.length === 0 ? "empty body (pot required)" : null,
      };
    } catch (e) {
      return { success: false, error: String(e).slice(0, 120), language: pick.languageCode ?? null };
    }
  }, prefLang);
}

/**
 * Method C: enable captions + play, then wait for the MAIN-world interceptor to
 * capture YouTube's own timedtext response. Returns the first non-empty body.
 */
export async function methodCIntercept(page, { prefLang = "en", timeoutMs = 30000 } = {}) {
  const started = Date.now();

  const trigger = () =>
    page.evaluate(
      async ({ lang }) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const p = document.querySelector("#movie_player");
        const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
        const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
        const pick =
          tracks.find((t) => String(t.languageCode || "").startsWith(lang) && t.kind !== "asr") ||
          tracks.find((t) => String(t.languageCode || "").startsWith(lang)) ||
          tracks[0];
        // Turn captions ON via the player API (authoritative).
        try {
          p?.setOption?.("captions", "track", pick ? { languageCode: pick.languageCode } : { languageCode: lang });
        } catch {}
        // Toggle the CC control: this is what reliably triggers the pot-signed
        // caption XHR now that the interceptor is active.
        document.querySelector(".ytp-subtitles-button")?.click();
        try {
          p?.playVideo?.();
        } catch {}
        const on = document.querySelector(".ytp-subtitles-button")?.getAttribute("aria-pressed") === "true";
        return {
          trackCount: tracks.length,
          picked: pick ? { lang: pick.languageCode, kind: pick.kind ?? "manual" } : null,
          ccOn: Boolean(on),
        };
      },
      { lang: prefLang },
    );

  const waitForCapture = (remaining) =>
    page
      .waitForFunction(
        () => Array.isArray(window.__yairRnd) && window.__yairRnd.some((c) => c && c.bytes > 0),
        { timeout: Math.max(1500, remaining), polling: 400 },
      )
      .then(() => true)
      .catch(() => false);

  const bestCapture = () =>
    page.evaluate(() => {
      const caps = (window.__yairRnd || []).filter((c) => c && c.bytes > 0);
      caps.sort((a, b) => b.bytes - a.bytes);
      return caps[0] || null;
    });

  let meta = await trigger();
  let ok = await waitForCapture(timeoutMs);
  // Retry with a fresh toggle if no caption response arrived.
  for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    meta = await trigger();
    ok = await waitForCapture(Math.max(2500, timeoutMs - (Date.now() - started)));
  }
  // Grace period: the player may emit a second, larger response for the same track.
  if (ok) await new Promise((r) => setTimeout(r, 2500));

  const latencyMs = Date.now() - started;
  const capture = await bestCapture();
  if (!capture) return { success: false, latencyMs, error: "no caption response captured", meta };
  return {
    success: true,
    latencyMs,
    via: capture.via,
    hasPot: capture.hasPot,
    bytes: capture.bytes,
    paramKeys: capture.paramKeys,
    text: capture.text,
    meta,
    error: null,
  };
}

/** Method D: sample rendered caption DOM while playing (lossy, real-time). */
export async function methodDDomCaptions(page, { seconds = 12, intervalMs = 1500 } = {}) {
  const started = Date.now();
  const seen = new Set();
  const segments = [];
  const steps = Math.ceil((seconds * 1000) / intervalMs);
  for (let i = 0; i < steps; i += 1) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const sample = await page.evaluate(() => {
      const segs = Array.from(document.querySelectorAll(".ytp-caption-segment"))
        .map((n) => n.textContent?.trim())
        .filter(Boolean);
      const v = document.querySelector("video");
      return { t: v?.currentTime ?? 0, segs };
    });
    for (const text of sample.segs) {
      const key = `${Math.round(sample.t)}|${text}`;
      if (!seen.has(key)) {
        seen.add(key);
        segments.push({ start: sample.t, text });
      }
    }
    if (segments.length > 0 && i >= steps - 1) break;
  }
  return { success: segments.length > 0, latencyMs: Date.now() - started, segments };
}

/** Method F: call the native transcript-panel InnerTube endpoint. */
export async function methodFTranscriptPanel(page) {
  return page.evaluate(async () => {
    const walk = (o) => {
      let found = null;
      const rec = (x) => {
        if (found || !x || typeof x !== "object") return;
        for (const k of Object.keys(x)) {
          if (k === "getTranscriptEndpoint" && x[k]?.params) {
            found = x[k].params;
            return;
          }
          rec(x[k]);
        }
      };
      rec(o);
      return found;
    };
    const params = walk(window.ytInitialData);
    if (!params) return { success: false, error: "no getTranscriptEndpoint params" };
    const cfg = window.ytcfg;
    const get = (k) => (typeof cfg?.get === "function" ? cfg.get(k) : undefined);
    try {
      const r = await fetch(
        `/youtubei/v1/get_transcript?key=${encodeURIComponent(get("INNERTUBE_API_KEY") || "")}&prettyPrint=false`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: get("INNERTUBE_CONTEXT"), params }),
          credentials: "include",
        },
      );
      const text = await r.text();
      const segments = (text.match(/"transcriptSegmentRenderer"/g) || []).length;
      return { success: r.status === 200 && segments > 0, status: r.status, segments, error: r.status === 200 ? null : text.slice(0, 100) };
    } catch (e) {
      return { success: false, error: String(e).slice(0, 120) };
    }
  });
}

export async function closeBrowser(browser) {
  try {
    await browser.close();
  } catch {
    /* ignore */
  }
}
