/**
 * Pure parser for YouTube's json3 caption format, plus normalisation.
 *
 * This mirrors `backend/app/services/subtitles.py::parse_json3` closely enough
 * to compare browser/server output, and is dependency-free so it can run in a
 * content script, a worker, Node, or a vitest.
 */

export interface RawSegment {
  start: number;
  end: number;
  text: string;
}

interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  segs?: Array<{ utf8?: string }>;
}

const TAG_RE = /<[^>]+>/g;
const END_CHARS = /[.!?。！？"']$/;

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\u200b/g, "")
    .trim();
}

/** Parse a json3 payload into phrase-level segments. */
export function parseJson3(content: string): RawSegment[] {
  let data: { events?: Json3Event[] };
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }
  const events = data.events || [];
  const raw: RawSegment[] = [];
  for (const event of events) {
    if (!event.segs || event.segs.length === 0) continue;
    if (event.tStartMs == null) continue;
    let text = event.segs.map((seg) => seg.utf8 ?? "").join("");
    text = cleanText(text.replace(TAG_RE, ""));
    if (!text) continue;
    const start = event.tStartMs / 1000;
    const duration = (event.dDurationMs ?? 0) / 1000;
    raw.push({ start, end: start + Math.max(duration, 0.05), text });
  }
  if (raw.length === 0) return [];

  // Auto captions arrive as many tiny word-level events; group them.
  const shortEvents = raw.filter((e) => e.text.split(" ").length <= 3).length / raw.length;
  if (raw.length > 20 && shortEvents > 0.6) return groupWordEvents(raw);
  return raw.map((e) => ({ start: e.start, end: Math.max(e.end, e.start), text: e.text }));
}

function groupWordEvents(raw: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  let words: string[] = [];
  let start = raw[0].start;
  let end = raw[0].end;
  for (const event of raw) {
    const gap = event.start - end;
    const wordsInCurrent = words.reduce((n, w) => n + w.split(" ").length, 0);
    if (words.length && (gap > 1.2 || wordsInCurrent >= 9 || END_CHARS.test(event.text))) {
      out.push({ start, end: Math.max(end, start), text: words.join(" ").trim() });
      words = [];
      start = event.start;
    }
    words.push(event.text);
    end = event.end;
  }
  if (words.length) out.push({ start, end: Math.max(end, start), text: words.join(" ").trim() });
  return out;
}

/** Remove rolling-caption duplication common in auto captions. */
export function dedupeRolling(segments: RawSegment[]): RawSegment[] {
  const out: RawSegment[] = [];
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    if (out.length) {
      const prev = out[out.length - 1].text.trim();
      if (text === prev) {
        out[out.length - 1].end = Math.max(out[out.length - 1].end, seg.end);
        continue;
      }
      if (text.startsWith(prev) && text.length > prev.length) {
        out[out.length - 1] = {
          start: out[out.length - 1].start,
          end: Math.max(out[out.length - 1].end, seg.end),
          text,
        };
        continue;
      }
      if (prev.startsWith(text) && prev.length >= text.length) {
        out[out.length - 1].end = Math.max(out[out.length - 1].end, seg.end);
        continue;
      }
    }
    out.push({ start: seg.start, end: Math.max(seg.end, seg.start), text });
  }
  return out;
}

/** Full normalisation: clean, sort, dedupe, enforce monotonic durations. */
export function normalizeSegments(segments: RawSegment[]): RawSegment[] {
  const cleaned = segments
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: cleanText(s.text) }))
    .filter((s) => s.text.length > 0);
  cleaned.sort((a, b) => a.start - b.start || a.end - b.end);
  const deduped = dedupeRolling(cleaned);
  for (let i = 0; i < deduped.length; i += 1) {
    const seg = deduped[i];
    if (seg.end <= seg.start) {
      const next = i + 1 < deduped.length ? deduped[i + 1].start : seg.start + 2;
      seg.end = Math.max(seg.start + 0.5, Math.min(next, seg.start + 8));
    }
  }
  return deduped;
}

export interface Summary {
  segmentCount: number;
  characterCount: number;
  wordCount: number;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  timestamped: boolean;
}

export function summarize(segments: RawSegment[]): Summary {
  const characterCount = segments.reduce((n, s) => n + s.text.length, 0);
  const wordCount = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  return {
    segmentCount: segments.length,
    characterCount,
    wordCount,
    firstTimestamp: segments.length ? segments[0].start : null,
    lastTimestamp: segments.length ? segments[segments.length - 1].start : null,
    timestamped: segments.length > 0 && segments.every((s) => Number.isFinite(s.start)),
  };
}

export function toText(segments: RawSegment[]): string {
  return segments.map((s) => `[${formatStamp(s.start)}] ${s.text}`).join("\n\n");
}

function formatStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
