#!/usr/bin/env node
/**
 * Extension-viable Method C: MAIN-world fetch/XHR interception.
 * Mirrors what the real MV3 extension will do (no CDP getResponseBody).
 * Patches window.fetch + XMLHttpRequest before page scripts run, captures the
 * body of timedtext responses YouTube's player requests, and reports segments.
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

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  );

  // Install the interceptor in the page's MAIN world before any YouTube script.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.__yairCaptured = [];
    const isTimedtext = (u) => typeof u === "string" && /\/api\/timedtext/i.test(u);

    const origFetch = window.fetch;
    window.fetch = function (...args) {
      const input = args[0];
      const url = typeof input === "string" ? input : input && input.url;
      const p = origFetch.apply(this, args);
      if (isTimedtext(url)) {
        p.then((res) => {
          try {
            res.clone().text().then((text) => {
              window.__yairCaptured.push({
                via: "fetch",
                urlKeys: (() => { try { return [...new URL(url, location.href).searchParams.keys()]; } catch { return []; } })(),
                hasPot: /[?&]pot=/.test(url),
                bytes: text.length,
                text,
              });
            });
          } catch {}
        }).catch(() => {});
      }
      return p;
    };

    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const xhr = new OrigXHR();
      let url = "";
      const open = xhr.open;
      xhr.open = function (method, u, ...rest) { url = u; return open.call(this, method, u, ...rest); };
      xhr.addEventListener("load", () => {
        if (isTimedtext(url)) {
          try {
            window.__yairCaptured.push({
              via: "xhr",
              urlKeys: (() => { try { return [...new URL(url, location.href).searchParams.keys()]; } catch { return []; } })(),
              hasPot: /[?&]pot=/.test(url),
              bytes: (xhr.responseText || "").length,
              text: xhr.responseText || "",
            });
          } catch {}
        }
      });
      return xhr;
    }
    PatchedXHR.prototype = OrigXHR.prototype;
    window.XMLHttpRequest = PatchedXHR;
  });

  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2000));
  await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1&cc_load_policy=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  await page.evaluate((prefLang) => {
    const p = document.querySelector("#movie_player");
    const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const pick = tracks.find((t) => t.languageCode?.startsWith(prefLang)) || tracks[0];
    try { p?.setOption("captions", "track", { languageCode: pick?.languageCode || prefLang }); } catch {}
    document.querySelector(".ytp-subtitles-button")?.click?.();
    try { p?.playVideo(); } catch {}
  }, lang);

  // Wait until we capture a non-empty caption body (or time out).
  const captured = await page
    .waitForFunction(
      () => (window.__yairCaptured || []).some((c) => c && c.bytes > 0),
      { timeout: 25000, polling: 500 },
    )
    .then(() => page.evaluate(() => window.__yairCaptured.filter((c) => c.bytes > 0).map((c) => ({ via: c.via, hasPot: c.hasPot, bytes: c.bytes, segmentEvents: (() => { try { return (JSON.parse(c.text).events || []).filter((e) => e.segs?.length).length; } catch { return -1; } })(), firstEvent: (() => { try { const e = (JSON.parse(c.text).events || []).find((x) => x.segs?.length); return e ? e.segs.map((s) => s.utf8).join("").trim().slice(0, 60) : null; } catch { return null; } })() }))))
    .catch(() => [])
    .then((v) => v);

  console.log(JSON.stringify({ id, lang, captured, allAttempts: await page.evaluate(() => (window.__yairCaptured || []).map((c) => ({ via: c.via, hasPot: c.hasPot, bytes: c.bytes }))) }, null, 2));
} finally {
  await browser.close();
}
