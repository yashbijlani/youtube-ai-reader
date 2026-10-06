/**
 * R&D: production-shaped browser transcript provider.
 *
 * Fallback chain (to be validated by the R&D results):
 *   1. main_world_intercept  — observe YouTube's own signed caption XHR
 *   2. transcript_panel      — scrape YouTube's own transcript panel (no playback)
 *   3. caption_dom           — scrape rendered captions while playing (lossy)
 *   4. (caller falls back to server-side yt-dlp via the existing API)
 *
 * The provider is written against a small `PageScripting` seam so it can run in
 * the MV3 background worker and be unit-tested with a fake.
 */

import { pageInterceptor, type PageInterceptorConfig } from "./page-interceptor";
import { parseJson3, normalizeSegments, type RawSegment } from "./parseJson3";
import { captureDomCaptions, captureTranscriptPanel, getMediaDuration, inspectCaptionTracks, triggerCaptionRequest, type CaptionTrackInfo } from "./methods";
import type { ExtractionMethod } from "./types";

interface RawCapture {
  via: string;
  hasPot: boolean;
  bytes: number;
  paramKeys: string[];
  text: string;
  videoId?: string;
  pageVideoId?: string;
}

export interface BrowserTranscriptResult {
  method: ExtractionMethod;
  segments: RawSegment[];
  json3: string | null;
  language: string | null;
  captionTracks: CaptionTrackInfo | null;
  latencyMs: number;
  sourceInfo: Record<string, unknown>;
}

/** Seam over `chrome.scripting`. */
export interface PageScripting {
  injectMainWorld<T>(tabId: number, func: (...args: never[]) => T, args: unknown[]): Promise<void>;
  evaluateMainWorld<T>(tabId: number, func: (...args: never[]) => T, args: unknown[]): Promise<T>;
}

/** Default implementation backed by the MV3 `chrome.scripting` API. */
export class ChromePageScripting implements PageScripting {
  async injectMainWorld<T>(tabId: number, func: (...args: never[]) => T, args: unknown[]): Promise<void> {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: func as (...a: unknown[]) => T,
      args,
    });
  }

  async evaluateMainWorld<T>(tabId: number, func: (...args: never[]) => T, args: unknown[]): Promise<T> {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: func as (...a: unknown[]) => T,
      args,
    });
    return results[0]?.result as T;
  }
}

/** Ignore absurd/abusive caption payloads (a transcript is never this large). */
export const MAX_CAPTURE_BYTES = 8_000_000;

/**
 * Read the largest caption body the MAIN-world interceptor stashed on
 * `window.__yairCaptured`, restricted to the requested video id. On YouTube the
 * page is not reloaded between videos, so the buffer accumulates across videos;
 * filtering by the caption URL's `v` param ensures we never ingest a previous
 * video's captions under the new one.
 *
 * Self-contained: Chrome serializes this function body into the page.
 */
export function readPageCaptures(videoId = ""): RawCapture | null {
  const w = window as unknown as { __yairCaptured?: RawCapture[] };
  // 8_000_000 must match MAX_CAPTURE_BYTES (function body is serialized alone).
  const caps = (w.__yairCaptured || []).filter(
    (c) => c && c.bytes > 0 && c.bytes <= 8_000_000,
  );
  // Prefer captures whose caption URL `v` matches. If none do, accept a capture
  // that lacks a `v` but was emitted on the watch page for this same video.
  let candidates = videoId ? caps.filter((c) => c.videoId === videoId) : caps;
  if (videoId && candidates.length === 0) {
    candidates = caps.filter((c) => !c.videoId && c.pageVideoId === videoId);
  }
  candidates.sort((a, b) => b.bytes - a.bytes);
  return candidates[0] || null;
}

export interface BrowserProviderOptions {
  prefLang?: string;
  /** Only accept captures that belong to this YouTube video id. */
  videoId?: string;
  interceptTimeoutMs?: number;
  domFallbackMs?: number;
  /** How long the largest capture must stay stable before we stop (tests). */
  stableMs?: number;
  /** Override for tests. */
  scripting?: PageScripting;
  now?: () => number;
}

export class BrowserTranscriptProvider {
  private readonly scripting: PageScripting;
  private readonly now: () => number;

  constructor(options: BrowserProviderOptions = {}) {
    this.scripting = options.scripting ?? new ChromePageScripting();
    this.now = options.now ?? (() => Date.now());
  }

  async extract(tabId: number, options: BrowserProviderOptions = {}): Promise<BrowserTranscriptResult | null> {
    const prefLang = options.prefLang ?? "en";
    const expectedVideoId = options.videoId ?? "";
    const timeoutMs = options.interceptTimeoutMs ?? 25000;
    const domMs = options.domFallbackMs ?? 8000;
    const started = this.now();

    const tracks = await this.scripting.evaluateMainWorld<CaptionTrackInfo>(
      tabId,
      inspectCaptionTracks as (...a: never[]) => CaptionTrackInfo,
      [prefLang],
    ).catch(() => null);

    const token = `yair-${Math.random().toString(36).slice(2)}`;
    const config: PageInterceptorConfig = { token, source: "yair-rnd", patchFetch: true };
    await this.scripting.injectMainWorld(tabId, pageInterceptor as unknown as (...a: never[]) => void, [config]);
    const duration = await this.scripting
      .evaluateMainWorld<number>(tabId, getMediaDuration as (...a: never[]) => number, [])
      .catch(() => 0);
    await this.scripting.evaluateMainWorld(tabId, triggerCaptionRequest as unknown as (...a: never[]) => CaptionTrackInfo, [prefLang]);

    // Poll for the caption response, retriggering the player a couple of times
    // for slow/ASR-only tracks. Retriggers only toggle YouTube's own captions in
    // the page; they never touch our server or yt-dlp.
    //
    // We keep the largest capture and stop as soon as it is *complete* (covers
    // most of the video). If it looks partial we keep waiting for a later, full
    // response (the player can deliver it several seconds in) with retriggers.
    const deadline = started + timeoutMs;
    let capture: RawCapture | null = null;
    let best: RawCapture | null = null;
    let bestBytes = 0;
    let lastTimestamp = 0;
    let nextRetrigger = started + 6_000;
    let retriggers = 0;
    let graceUntil = 0;
    const maxRetriggers = 3;
    // With a known duration we allow longer for the full track to arrive; if the
    // duration is unknown (tests/edge cases) keep the wait short.
    const stableMs = options.stableMs ?? (duration > 0 ? 8_000 : 800);
    while (this.now() < deadline) {
      capture = await this.scripting.evaluateMainWorld<RawCapture | null>(
        tabId,
        readPageCaptures as (...a: never[]) => RawCapture | null,
        [expectedVideoId],
      );
      if (capture?.bytes) {
        if (capture.bytes > bestBytes) {
          bestBytes = capture.bytes;
          best = capture;
          const segments = normalizeSegments(parseJson3(capture.text));
          lastTimestamp = segments.length ? (segments[segments.length - 1].start ?? 0) : 0;
          graceUntil = this.now() + stableMs;
        }
        const complete = duration > 0 && lastTimestamp >= duration * 0.9;
        if (complete || this.now() >= graceUntil) break;
      } else if (this.now() >= nextRetrigger && retriggers < maxRetriggers) {
        retriggers += 1;
        nextRetrigger = this.now() + 6_000;
        await this.scripting
          .evaluateMainWorld(tabId, triggerCaptionRequest as unknown as (...a: never[]) => CaptionTrackInfo, [prefLang])
          .catch(() => null);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    capture = best;
    console.log(
      `[yair] browser method=intercept bytes=${bestBytes} segments=${capture ? normalizeSegments(parseJson3(capture.text)).length : 0}`,
    );

    if (capture?.text) {
      const segments = normalizeSegments(parseJson3(capture.text));
      if (segments.length > 0) {
        return {
          method: "main_world_intercept",
          segments,
          json3: capture.text,
          language: tracks?.picked?.languageCode ?? null,
          captionTracks: tracks,
          latencyMs: this.now() - started,
          sourceInfo: { via: capture.via, hasPot: capture.hasPot, bytes: capture.bytes },
        };
      }
    }

    // ---- Fallback 1: YouTube's own transcript panel (no playback required)
    const panel = await this.scripting
      .evaluateMainWorld<Array<{ start: number; text: string }>>(
        tabId,
        captureTranscriptPanel as unknown as (...a: never[]) => Array<{ start: number; text: string }>,
        [10000],
      )
      .catch(() => []);
    console.log(`[yair] browser method=panel segments=${panel?.length ?? 0}`);
    if (panel && panel.length > 0) {
      return {
        method: "transcript_panel",
        segments: panel.map((d) => ({ start: d.start, end: d.start, text: d.text })),
        json3: null,
        language: tracks?.picked?.languageCode ?? null,
        captionTracks: tracks,
        latencyMs: this.now() - started,
        sourceInfo: { samples: panel.length, via: "transcript_panel" },
      };
    }

    // ---- Fallback 2: rendered captions (lossy)
    const dom = await this.scripting
      .evaluateMainWorld<Array<{ start: number; text: string }>>(
        tabId,
        captureDomCaptions as unknown as (...a: never[]) => Array<{ start: number; text: string }>,
        [domMs, 1000],
      )
      .catch(() => []);
    console.log(`[yair] browser method=dom segments=${dom?.length ?? 0}`);
    if (dom && dom.length > 0) {
      return {
        method: "caption_dom",
        segments: dom.map((d) => ({ start: d.start, end: d.start, text: d.text })),
        json3: null,
        language: tracks?.picked?.languageCode ?? null,
        captionTracks: tracks,
        latencyMs: this.now() - started,
        sourceInfo: { samples: dom.length, lossy: true },
      };
    }

    return null;
  }
}

/** Map a result onto the extension's client-transcript payload shape. */
export function toClientPayload(result: BrowserTranscriptResult, videoId = "") {
  return {
    videoId,
    language: result.language ?? "en",
    kind: result.captionTracks?.picked?.kind === "asr" ? ("auto" as const) : ("manual" as const),
    format: result.json3 ? ("json3" as const) : ("segments" as const),
    content: result.json3 ?? undefined,
    segments: result.json3
      ? undefined
      : result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    method: result.method === "caption_dom" ? ("caption_dom" as const) : ("browser_intercept" as const),
  };
}

/** Build the existing backend `/api/videos/{id}/ingest` payload for a result. */
export function toIngestPayload(
  result: BrowserTranscriptResult,
  meta: { title?: string; channel?: string; duration?: number } = {},
) {
  if (result.json3) {
    return {
      title: meta.title,
      channel: meta.channel,
      duration: meta.duration,
      language: result.language ?? "en",
      kind: result.captionTracks?.picked?.kind === "asr" ? ("auto" as const) : ("manual" as const),
      format: "json3" as const,
      content: result.json3,
    };
  }
  return {
    title: meta.title,
    channel: meta.channel,
    duration: meta.duration,
    language: result.language ?? "en",
    kind: "auto" as const,
    format: "segments" as const,
    segments: result.segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
}
