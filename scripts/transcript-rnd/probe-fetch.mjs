#!/usr/bin/env node
/**
 * Focused experiment: does fetching the caption track baseUrl from within the
 * YouTube page context (MAIN world) still return caption JSON, despite the
 * proof-of-origin (pot) requirements? This is the pivotal Method A test.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["aircAruvnKk"];

function redact(url) {
  try {
    return url.replace(/([?&][^=]+)=([^&]*)/g, "$1=REDACTED").slice(0, 90);
  } catch {
    return String(url).slice(0, 60);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--lang=en-US"],
});

try {
  for (const id of targets) {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});
    const result = await page.evaluate(async () => {
      const pr =
        window.ytInitialPlayerResponse ||
        document.querySelector("#movie_player")?.getPlayerResponse?.();
      const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const pick =
        tracks.find((t) => String(t.languageCode).startsWith("en") && t.kind !== "asr") ||
        tracks.find((t) => String(t.languageCode).startsWith("en")) ||
        tracks[0];
      if (!pick?.baseUrl) return { ok: false, error: "no-baseUrl", tracks: tracks.length };
      const attempts = [];
      for (const [label, url] of [
        ["json3", pick.baseUrl.includes("fmt=") ? pick.baseUrl : `${pick.baseUrl}&fmt=json3`],
        ["raw", pick.baseUrl],
      ]) {
        const started = performance.now();
        try {
          const r = await fetch(url, { credentials: "include" });
          const text = await r.text();
          attempts.push({
            label,
            status: r.status,
            bytes: text.length,
            contentType: r.headers.get("content-type"),
            looksJson: text.trimStart().startsWith("{"),
            latencyMs: Math.round(performance.now() - started),
            head: text.slice(0, 60),
          });
        } catch (e) {
          attempts.push({ label, error: String(e).slice(0, 120) });
        }
      }
      return {
        ok: true,
        trackCount: tracks.length,
        picked: { lang: pick.languageCode, kind: pick.kind ?? "manual" },
        baseUrlShape: pick.baseUrl
          .replace(/([?&][^=]+)=([^&]*)/g, "$1=REDACTED")
          .slice(0, 80),
        attempts,
      };
    });
    console.log(JSON.stringify({ id, ...result }, null, 2));
    await page.close();
  }
} finally {
  await browser.close();
}
