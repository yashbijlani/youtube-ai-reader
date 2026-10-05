#!/usr/bin/env node
/**
 * Compare browser-intercepted transcripts against the server yt-dlp baseline for
 * the same videos: size, timestamps, and normalised text overlap. Writes
 * results/comparison.json and prints a markdown table.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";

const dir = new URL("./results/transcripts/", import.meta.url);

const normalize = (text) =>
  text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (text) => normalize(text).split(" ").filter((w) => w.length > 1);

function loadPair(id) {
  const b = new URL(`${id}.browser.json`, dir);
  const s = new URL(`${id}.server.json`, dir);
  if (!existsSync(b) || !existsSync(s)) return null;
  return { browser: JSON.parse(readFileSync(b, "utf8")), server: JSON.parse(readFileSync(s, "utf8")) };
}

const rows = [];
if (existsSync(dir)) {
  const ids = [...new Set(readdirSync(dir).filter((f) => f.endsWith(".browser.json")).map((f) => f.replace(".browser.json", "")))];
  const stop = new Set(["the", "and", "that", "this", "with", "for", "you", "your", "are", "was", "have", "but", "not", "they", "it's", "its", "from", "what", "there", "here", "will", "just", "like"]);
  for (const id of ids) {
    const pair = loadPair(id);
    if (!pair) continue;
    const bText = pair.browser.segments.map((s) => s.text).join(" ");
    const sText = pair.server.segments.map((s) => s.text).join(" ");
    const bWords = new Set(words(bText).filter((w) => !stop.has(w)));
    const sWords = new Set(words(sText).filter((w) => !stop.has(w)));
    let overlap = 0;
    for (const w of bWords) if (sWords.has(w)) overlap += 1;
    const containment = bWords.size ? overlap / bWords.size : 0;
    const bLast = pair.browser.segments.at(-1)?.start ?? null;
    const sLast = pair.server.segments.at(-1)?.start ?? null;
    rows.push({
      video_id: id,
      category: pair.browser.category ?? null,
      browser_segments: pair.browser.segments.length,
      server_segments: pair.server.segments.length,
      browser_chars: bText.length,
      server_chars: sText.length,
      browser_words: words(bText).length,
      server_words: words(sText).length,
      browser_last_ts: bLast,
      server_last_ts: sLast,
      duration: pair.browser.duration ?? pair.server.duration ?? null,
      browser_kind: pair.browser.kind ?? null,
      server_kind: pair.server.kind ?? null,
      browser_lang: pair.browser.language ?? null,
      server_lang: pair.server.language ?? null,
      vocabulary_containment: Math.round(containment * 1000) / 1000,
    });
  }
}

writeFileSync(new URL("comparison.json", dir), JSON.stringify(rows, null, 2));
console.log("| Video | Cat | Browser segs | Server segs | Browser words | Server words | Last ts (b/s) | Vocab overlap |");
console.log("|---|---|---:|---:|---:|---:|---|---:|");
for (const r of rows) {
  console.log(
    `| ${r.video_id} | ${r.category ?? "?"} | ${r.browser_segments} | ${r.server_segments} | ${r.browser_words} | ${r.server_words} | ${r.browser_last_ts ?? "?"}/${r.server_last_ts ?? "?"} | ${(r.vocabulary_containment * 100).toFixed(0)}% |`,
  );
}
const avg = rows.length ? rows.reduce((a, r) => a + r.vocabulary_containment, 0) / rows.length : 0;
console.log(`\nPairs compared: ${rows.length}. Mean vocabulary containment (browser ∩ server / browser): ${(avg * 100).toFixed(1)}%`);
