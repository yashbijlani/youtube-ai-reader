#!/usr/bin/env node
/**
 * Build a representative engineering test corpus from a handful of YouTube
 * searches (not mass scraping). Outputs corpus.json with intended-category tags;
 * actual properties (captions/language/duration) are detected later by the
 * experiment runner.
 */
import { writeFileSync } from "node:fs";
import { launchBrowser, preparePage, closeBrowser } from "./lib.mjs";

const PER_QUERY = 6;

const QUERIES = [
  { category: "A_normal_podcast", query: "podcast interview english" },
  { category: "B_long_podcast", query: "3 hour podcast conversation" },
  { category: "G_popular", query: "most viewed music video of all time" },
  { category: "C_auto_captions", query: "vlog no subtitles english" },
  { category: "D_manual_captions", query: "documentary subtitles english" },
  { category: "F_multilanguage", query: "noticias en espanol podcast" },
  { category: "I_shorts", query: "news #shorts" },
  { category: "J_live", query: "live news stream" },
  { category: "H_recent", query: "news today" },
  { category: "E_no_captions", query: "ambient rain sounds no talking" },
];

function parseDurationText(text) {
  if (!text) return null;
  const parts = String(text).split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function search(page, query) {
  await page.goto(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en`,
    { waitUntil: "domcontentloaded", timeout: 45000 },
  );
  await page.waitForFunction(() => Boolean(window.ytInitialData), { timeout: 20000 }).catch(() => {});
  return page.evaluate(() => {
    const d = window.ytInitialData;
    const out = [];
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (o.videoRenderer?.videoId) {
        const v = o.videoRenderer;
        out.push({
          id: v.videoId,
          title: v.title?.runs?.[0]?.text || v.title?.simpleText || null,
          channel: v.ownerText?.runs?.[0]?.text || null,
          durationText: v.lengthText?.simpleText || null,
        });
      }
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(d);
    return out;
  });
}

const browser = await launchBrowser();
const seen = new Set();
const corpus = [];
try {
  const page = await browser.newPage();
  await preparePage(page, "discover");
  for (const { category, query } of QUERIES) {
    const found = await search(page, query);
    let added = 0;
    for (const item of found) {
      if (!item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      corpus.push({
        id: item.id,
        category,
        query,
        title: item.title,
        channel: item.channel,
        duration_seconds: parseDurationText(item.durationText),
      });
      added += 1;
      if (added >= PER_QUERY) break;
    }
    console.error(`[discover] ${category}: +${added}`);
  }
  writeFileSync(new URL("./corpus.json", import.meta.url), JSON.stringify(corpus, null, 2));
  console.error(`[discover] wrote ${corpus.length} videos to corpus.json`);
  console.log(JSON.stringify({ count: corpus.length, byCategory: corpus.reduce((a, c) => ((a[c.category] = (a[c.category] || 0) + 1), a), {}) }, null, 2));
} finally {
  await closeBrowser(browser);
}
