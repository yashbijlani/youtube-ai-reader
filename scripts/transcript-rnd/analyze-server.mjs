#!/usr/bin/env node
/** Compute Method I (server yt-dlp) stats from results/server.json. */
import { readFileSync, existsSync } from "node:fs";

const dir = new URL("./results/", import.meta.url);
const rows = existsSync(new URL("server.json", dir)) ? JSON.parse(readFileSync(new URL("server.json", dir), "utf8")) : [];
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const vals = (a) => a.map(num).filter((x) => x != null).sort((x, y) => x - y);
const median = (a) => { const v = vals(a); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2); };
const p95 = (a) => { const v = vals(a); return v.length ? v[Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1)] : null; };
const avg = (a) => { const v = vals(a); return v.length ? Math.round(v.reduce((x, y) => x + y, 0) / v.length) : null; };

const ok = rows.filter((r) => r.success);
const rateLimited = rows.filter((r) => /rate_limited/i.test(r.error || ""));
const noCaption = rows.filter((r) => /transcript_unavailable/i.test(r.error || ""));
const errors = {};
for (const r of rows) if (!r.success) {
  const code = (r.error || "unknown").split(":")[0];
  errors[code] = (errors[code] || 0) + 1;
}
const out = {
  total: rows.length,
  success: ok.length,
  successRate: rows.length ? Math.round((ok.length / rows.length) * 1000) / 10 : null,
  timestamped: ok.length,
  medianLatencyMs: median(ok.map((r) => r.latency_ms)),
  p95LatencyMs: p95(ok.map((r) => r.latency_ms)),
  avgLatencyMs: avg(ok.map((r) => r.latency_ms)),
  avgSegments: avg(ok.map((r) => r.segment_count)),
  rateLimitedFailures: rateLimited.length,
  noCaptionFailures: noCaption.length,
  errorBreakdown: errors,
};
console.log(JSON.stringify(out, null, 2));
