#!/usr/bin/env node
/**
 * Run browser-side transcript extraction experiments across the corpus and
 * write machine-readable results.
 *
 *   node run-experiments.mjs --limit 10 --methods A,C,F
 *   node run-experiments.mjs --dom
 *
 * Results: results/raw.json (incremental), plus a stdout stats summary.
 *
 * Robustness: sequential pages in one profile can leave YouTube's caption
 * preference in a bad state, so a failed Method C is retried once on a fresh
 * page. This mirrors the production behaviour of retrying in a fresh tab.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  launchBrowser,
  preparePage,
  warmUp,
  watchUrl,
  inspectVideo,
  methodAPlayerFetch,
  methodCIntercept,
  methodDDomCaptions,
  methodFTranscriptPanel,
  closeBrowser,
} from "./lib.mjs";
import { parseJson3, normalizeSegments, summarize } from "../../extension/src/transcript-rnd/parseJson3.ts";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

const limit = Number(getArg("limit", "0")) || Infinity;
const start = Number(getArg("start", "0")) || 0;
const methods = new Set((getArg("methods", "A,C,F") || "").split(",").map((s) => s.trim()));
const runDom = hasFlag("dom");
const saveText = hasFlag("saveText");
const outFile = new URL(`./results/${(getArg("out", "raw") || "raw")}.json`, import.meta.url);
const corpusPath = getArg("corpus", "corpus.json");
const corpus = JSON.parse(readFileSync(new URL(`./${corpusPath}`, import.meta.url), "utf8")).slice(start, start + limit);

mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
if (saveText) mkdirSync(new URL("./results/transcripts/", import.meta.url), { recursive: true });

function saveBrowserTranscript(item, c, inspected) {
  if (!saveText || !c?.text) return;
  try {
    const segments = normalizeSegments(parseJson3(c.text));
    writeFileSync(
      new URL(`./results/transcripts/${item.id}.browser.json`, import.meta.url),
      JSON.stringify(
        {
          video_id: item.id,
          source: "browser_intercept",
          title: inspected?.title ?? item.title ?? null,
          duration: inspected?.duration ?? null,
          language: inspected?.languages?.[0] ?? null,
          kind: null,
          segments,
        },
        null,
        1,
      ),
    );
  } catch (error) {
    console.error(`[run] transcript save failed ${item.id}: ${error}`);
  }
}
const results = existsSync(outFile) ? JSON.parse(readFileSync(outFile, "utf8")) : [];
const done = new Set(results.map((r) => r.video_id));

function parseBody(text, method, latencyMs, extra = {}) {
  if (!text) return { method, success: false, latency_ms: latencyMs, error: "empty body", ...extra };
  const segments = normalizeSegments(parseJson3(text));
  const summary = summarize(segments);
  return {
    method,
    success: segments.length > 0,
    latency_ms: latencyMs,
    segment_count: summary.segmentCount,
    character_count: summary.characterCount,
    word_count: summary.wordCount,
    timestamped: summary.timestamped,
    first_timestamp: summary.firstTimestamp,
    last_timestamp: summary.lastTimestamp,
    error: segments.length === 0 ? "parsed 0 segments" : null,
    ...extra,
  };
}

const browser = await launchBrowser();
try {
  const warm = await browser.newPage();
  await preparePage(warm, "warm");
  await warmUp(warm);
  await warm.close();

  async function openPrepared(id, token) {
    const page = await browser.newPage();
    await preparePage(page, token);
    await page.goto(watchUrl(id), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});
    return page;
  }

  let index = 0;
  for (const item of corpus) {
    index += 1;
    if (done.has(item.id)) {
      console.error(`[run] ${index}/${corpus.length} ${item.id} (cached)`);
      continue;
    }
    const record = { video_id: item.id, category: item.category, corpus_title: item.title ?? null, inspected: null, methods: {}, timestamp: new Date().toISOString() };
    let page;
    try {
      page = await openPrepared(item.id, `t-${item.id}`);
      record.inspected = await inspectVideo(page);

      if (methods.has("A")) {
        const a = await methodAPlayerFetch(page);
        record.methods.player_response_fetch = a.text
          ? parseBody(a.text, "player_response_fetch", a.latencyMs, { status: a.status, bytes: a.bytes, language: a.language })
          : { method: "player_response_fetch", success: false, latency_ms: a.latencyMs ?? null, error: a.error ?? "failed", language: a.language ?? null };
      }

      if (methods.has("C")) {
        const duration = record.inspected?.duration ?? null;
        const score = (r) => (r?.success ? (r.last_timestamp ?? 0) * 1_000_000 + (r.segment_count ?? 0) : -1);
        const incomplete = (r) =>
          r?.success && duration && duration > 120 && (r.last_timestamp ?? 0) < 0.5 * duration;
        let c = await methodCIntercept(page, { timeoutMs: 25000 });
        if (!c.success || incomplete(c)) {
          // Fresh-page retry to clear bad caption state / partial responses.
          const first = c;
          await page.close().catch(() => {});
          page = await openPrepared(item.id, `r-${item.id}-${Date.now()}`);
          const second = await methodCIntercept(page, { timeoutMs: 25000 });
          c = score(second) >= score(first) ? second : first;
          c.retriedFreshPage = true;
        }
        record.methods.main_world_intercept = c.text
          ? parseBody(c.text, "main_world_intercept", c.latencyMs, { via: c.via, hasPot: c.hasPot, bytes: c.bytes, paramKeys: c.paramKeys ?? null, retriedFreshPage: c.retriedFreshPage ?? false })
          : { method: "main_world_intercept", success: false, latency_ms: c.latencyMs ?? null, error: c.error ?? "failed", retriedFreshPage: c.retriedFreshPage ?? false };
        saveBrowserTranscript(item, c, record.inspected);
      }

      if (runDom) {
        const d = await methodDDomCaptions(page, { seconds: 6, intervalMs: 1500 });
        const text = d.segments.map((s) => s.text).join(" ");
        record.methods.caption_dom = {
          method: "caption_dom",
          success: d.success,
          latency_ms: d.latencyMs,
          segment_count: d.segments.length,
          character_count: text.length,
          timestamped: d.segments.length > 0,
          error: d.success ? null : "no rendered captions",
        };
      }

      if (methods.has("F")) {
        const f = await methodFTranscriptPanel(page);
        record.methods.transcript_panel = {
          method: "transcript_panel",
          success: Boolean(f.success),
          segment_count: f.segments ?? 0,
          status: f.status ?? null,
          error: f.error ?? (f.success ? null : "failed"),
        };
      }

      const c = record.methods.main_world_intercept;
      if (c?.success && record.inspected?.duration) {
        c.coverage = c.last_timestamp ? Math.round((c.last_timestamp / record.inspected.duration) * 100) / 100 : null;
      }
      console.error(
        `[run] ${index}/${corpus.length} ${item.id} cat=${item.category} tracks=${record.inspected?.trackCount} C=${c?.success ? `ok ${c.segment_count}segs cov=${c.coverage}` : "fail"} A=${record.methods.player_response_fetch?.success ? "ok" : "fail"} F=${record.methods.transcript_panel?.success ? "ok" : "fail"}`,
      );
    } catch (error) {
      record.fatal = String(error).slice(0, 200);
      console.error(`[run] ${item.id} FATAL ${record.fatal}`);
    } finally {
      await page?.close().catch(() => {});
    }
    results.push(record);
    writeFileSync(outFile, JSON.stringify(results, null, 2));
  }
} finally {
  await closeBrowser(browser);
}

const byCat = {};
const bump = (cat, key) => { byCat[cat] = byCat[cat] || {}; byCat[cat][key] = (byCat[cat][key] || 0) + 1; };
for (const r of results) {
  const cat = r.category || "?";
  bump(cat, "n");
  if (r.inspected?.trackCount > 0) bump(cat, "has_captions");
  if (r.inspected && r.inspected.trackCount === 0) bump(cat, "no_captions");
  if (r.methods?.main_world_intercept?.success) bump(cat, "C_ok");
  if (r.methods?.player_response_fetch?.success) bump(cat, "A_ok");
  if (r.methods?.transcript_panel?.success) bump(cat, "F_ok");
}
console.log(JSON.stringify({ total: results.length, byCategory: byCat }, null, 2));
