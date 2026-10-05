#!/usr/bin/env node
/**
 * Merge raw browser results (raw.json + optional raw2.json) and compute the
 * measured statistics used by the engineering report. Writes results/summary.json
 * and prints a markdown table. Never invents numbers.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL("./results/", import.meta.url);
const load = (name) => (existsSync(new URL(name, dir)) ? JSON.parse(readFileSync(new URL(name, dir), "utf8")) : []);
const byId = new Map();
for (const f of ["raw.json", "raw2.json", "raw3.json"]) {
  for (const r of load(f)) byId.set(r.video_id, r);
}
const rows = [...byId.values()];

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const values = (arr) => arr.map(num).filter((x) => x != null).sort((a, b) => a - b);
const median = (arr) => {
  const v = values(arr);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};
const p95 = (arr) => {
  const v = values(arr);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)];
};
const avg = (arr) => {
  const v = values(arr);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

const withCaptions = rows.filter((r) => (r.inspected?.trackCount ?? 0) > 0);
const noCaptions = rows.filter((r) => r.inspected && r.inspected.trackCount === 0);

function methodStats(name, pool) {
  const attempted = pool.filter((r) => r.methods?.[name]);
  const ok = attempted.filter((r) => r.methods[name].success);
  const latencies = ok.map((r) => r.methods[name].latency_ms);
  return {
    attempted: attempted.length,
    success: ok.length,
    successRate: attempted.length ? Math.round((ok.length / attempted.length) * 1000) / 10 : null,
    timestampedRate: ok.length ? Math.round((ok.filter((r) => r.methods[name].timestamped).length / ok.length) * 1000) / 10 : null,
    medianLatencyMs: median(latencies),
    p95LatencyMs: p95(latencies),
    avgLatencyMs: avg(latencies),
    avgSegments: avg(ok.map((r) => r.methods[name].segment_count)),
    avgCharacters: avg(ok.map((r) => r.methods[name].character_count)),
  };
}

const methods = {
  "Player-response fetch (Method A)": methodStats("player_response_fetch", withCaptions),
  "MAIN-world intercept (Method C)": methodStats("main_world_intercept", withCaptions),
  "Rendered caption DOM (Method D)": methodStats("caption_dom", withCaptions),
  "Transcript panel (Method F)": methodStats("transcript_panel", withCaptions),
};

// Coverage quality of the intercepted transcripts.
const cOk = withCaptions.filter((r) => r.methods?.main_world_intercept?.success);
const coverages = cOk.map((r) => r.methods.main_world_intercept.coverage);
const full = coverages.filter((c) => c != null && c >= 0.9).length;
const partial = coverages.filter((c) => c != null && c < 0.9).length;

const byCategory = {};
for (const r of rows) {
  const cat = (byCategory[r.category] ||= { n: 0, has_captions: 0, no_captions: 0, C_success: 0 });
  cat.n += 1;
  if ((r.inspected?.trackCount ?? 0) > 0) cat.has_captions += 1;
  if (r.inspected && r.inspected.trackCount === 0) cat.no_captions += 1;
  if (r.methods?.main_world_intercept?.success) cat.C_success += 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  totalVideos: rows.length,
  videosWithCaptions: withCaptions.length,
  videosWithoutCaptions: noCaptions.length,
  categories: byCategory,
  methods,
  interceptQuality: {
    successWithFullCoverage: full,
    successWithPartialCoverage: partial,
    coverageOfSuccess: coverages.map((c) => ({ video_id: null, coverage: c })),
  },
  failures: rows
    .filter((r) => !r.methods?.main_world_intercept?.success)
    .map((r) => ({ video_id: r.video_id, category: r.category, tracks: r.inspected?.trackCount ?? null, error: r.methods?.main_world_intercept?.error ?? r.fatal ?? null })),
};

writeFileSync(new URL("summary.json", dir), JSON.stringify(summary, null, 2));

console.log(`# Transcript extraction — measured results`);
console.log(`\nVideos: ${rows.length} (captions available: ${withCaptions.length}, no captions: ${noCaptions.length})\n`);
console.log("| Method | Success | Success rate | Timestamped | Median latency | P95 latency | Avg segments |");
console.log("|---|---:|---:|---:|---:|---:|---:|");
for (const [label, s] of Object.entries(methods)) {
  console.log(`| ${label} | ${s.success}/${s.attempted} | ${s.successRate ?? "—"}% | ${s.timestampedRate ?? "—"}% | ${s.medianLatencyMs ?? "—"}ms | ${s.p95LatencyMs ?? "—"}ms | ${s.avgSegments ?? "—"} |`);
}
console.log(`\nIntercept coverage: ${full} full (≥90%), ${partial} partial (<90%) of ${cOk.length} successes`);
console.log("\n| Category | n | has captions | no captions | C success |");
console.log("|---|---:|---:|---:|---:|");
for (const [cat, c] of Object.entries(byCategory)) {
  console.log(`| ${cat} | ${c.n} | ${c.has_captions} | ${c.no_captions} | ${c.C_success} |`);
}
