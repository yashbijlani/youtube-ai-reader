#!/usr/bin/env node
/**
 * Viability probe: can a headless Chromium load a real YouTube watch page and
 * expose player/caption state? This decides whether the browser experiments in
 * run-experiments.mjs can produce real measurements in this environment.
 *
 * Never logs cookies, tokens or auth headers.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const videos = process.argv.slice(2);
const targets = videos.length ? videos : ["aircAruvnKk", "dQw4w9WgXcQ"];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--lang=en-US",
    "--window-size=1280,900",
  ],
});

try {
  for (const id of targets) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
    const url = `https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1`;
    let status = null;
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
      status = resp?.status() ?? null;
      await page.waitForFunction(
        () => {
          const p = document.querySelector("#movie_player");
          return Boolean(p) || Boolean(window.ytInitialPlayerResponse);
        },
        { timeout: 20000 },
      ).catch(() => {});
    } catch (e) {
      console.log(JSON.stringify({ id, navError: String(e).slice(0, 160) }));
      await page.close();
      continue;
    }
    const info = await page.evaluate(() => {
      const player = document.querySelector("#movie_player");
      const pr =
        player && typeof player.getPlayerResponse === "function"
          ? player.getPlayerResponse()
          : window.ytInitialPlayerResponse;
      const tracks =
        pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
      const consent =
        /consent|before you continue/i.test(document.body?.innerText?.slice(0, 400) ?? "");
      return {
        hasPlayer: Boolean(player),
        hasInitial: Boolean(window.ytInitialPlayerResponse),
        title: pr?.videoDetails?.title ?? null,
        playability: pr?.playabilityStatus?.status ?? null,
        playabilityReason: pr?.playabilityStatus?.reason ?? null,
        trackCount: Array.isArray(tracks) ? tracks.length : 0,
        trackLanguages: Array.isArray(tracks)
          ? tracks.slice(0, 5).map((t) => ({ lang: t.languageCode, kind: t.kind }))
          : [],
        baseUrlShape: Array.isArray(tracks) && tracks[0]?.baseUrl
          ? tracks[0].baseUrl.slice(0, 48).replace(/[?&]([^=]+)=[^&]*/g, "&$1=REDACTED")
          : null,
        consent,
      };
    });
    console.log(JSON.stringify({ id, status, ...info }));
    await page.close();
  }
} finally {
  await browser.close();
}
