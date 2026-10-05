#!/usr/bin/env node
/**
 * Probe methods C (network observation of YouTube's own caption requests),
 * D (rendered caption DOM), E (page globals) and F (native transcript panel).
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const ids = process.argv.slice(2);
const targets = ids.length ? ids : ["aircAruvnKk"];

function redact(u) {
  return String(u).replace(/([?&][^=]+)=([^&]*)/g, "$1=REDACTED").slice(0, 110);
}

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
  for (const id of targets) {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );

    // ----- Method C: observe caption network responses -----
    const seen = [];
    page.on("response", (response) => {
      const u = response.url();
      if (/timedtext|api\/timedtext|\/api\/v1\/get_transcript|get_transcript/i.test(u)) {
        const entry = { url: redact(u), status: response.status(), bytes: null, marker: null };
        seen.push(entry);
        response
          .text()
          .then((t) => {
            entry.bytes = t.length;
            entry.marker = t.trimStart().slice(0, 40);
          })
          .catch(() => {});
      }
    });

    await page.goto(`https://www.youtube.com/watch?v=${id}&hl=en&has_verified=1`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

    // Method E: page globals
    const globals = await page.evaluate(() => {
      const p = document.querySelector("#movie_player");
      const pr = p?.getPlayerResponse?.() || window.ytInitialPlayerResponse;
      return {
        hasMoviePlayer: Boolean(p),
        playerMethods: p
          ? ["setOption", "playVideo", "getPlayerResponse", "getOption", "getCurrentTime"].filter(
              (m) => typeof p[m] === "function",
            )
          : [],
        hasYtInitialPlayerResponse: Boolean(window.ytInitialPlayerResponse),
        hasYtcfg: Boolean(window.ytcfg),
        ytcfgKeys: (() => {
          const d = window.ytcfg?.data_;
          try {
            if (typeof d === "function") return Object.keys(d()).slice(0, 6);
            if (d && typeof d === "object") return Object.keys(d).slice(0, 6);
          } catch {}
          return [];
        })(),
        playability: pr?.playabilityStatus?.status ?? null,
        hasCaptionsModule: Boolean(pr?.captions),
        hasTranscriptEndpoint: Boolean(pr?.engagementPanels),
      };
    });

    // Enable captions + play to trigger YouTube's own caption request.
    const captionSetup = await page.evaluate(async () => {
      const p = document.querySelector("#movie_player");
      if (!p?.setOption) return { setup: false };
      try {
        p.setOption("captions", "track", { languageCode: "en" });
      } catch (e) {
        return { setup: false, error: String(e).slice(0, 80) };
      }
      try {
        p.playVideo();
      } catch {}
      return { setup: true };
    });
    await new Promise((r) => setTimeout(r, 6000));

    // Method D: rendered caption DOM
    const dom = await page.evaluate(() => {
      const nodes = document.querySelectorAll(
        ".ytp-caption-segment, .caption-visual-line, .ytp-caption-window-container",
      );
      const texts = Array.from(nodes)
        .map((n) => n.textContent?.trim())
        .filter(Boolean)
        .slice(0, 8);
      return { nodeCount: nodes.length, sample: texts };
    });

    // Method F: try to open the transcript panel
    const panel = await page.evaluate(async () => {
      function findButton() {
        const byAria = document.querySelector(
          'button[aria-label*="transcript" i], yt-button-shape button',
        );
        const candidates = Array.from(document.querySelectorAll("button, ytd-button-renderer")).filter(
          (el) => /transcript/i.test(el.getAttribute("aria-label") || el.textContent || ""),
        );
        return candidates[0] || (byAria && /transcript/i.test(byAria.getAttribute("aria-label") || "") ? byAria : null);
      }
      // expand description first
      const expand = document.querySelector(
        "tp-yt-paper-button#expand, #description #expand, ytd-text-inline-expander #expand",
      );
      expand?.click?.();
      await new Promise((r) => setTimeout(r, 700));
      const btn = findButton();
      btn?.click?.();
      await new Promise((r) => setTimeout(r, 3500));
      const segments = document.querySelectorAll(
        "ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer .segment",
      );
      const sample = Array.from(segments)
        .slice(0, 5)
        .map((s) => s.textContent?.replace(/\s+/g, " ").trim());
      return { buttonFound: Boolean(btn), segmentCount: segments.length, sample };
    });

    console.log(
      JSON.stringify(
        { id, globals, captionSetup, dom, panel, network: seen },
        null,
        2,
      ),
    );
    await page.close();
  }
} finally {
  await browser.close();
}
