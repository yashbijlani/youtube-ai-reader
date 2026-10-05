/**
 * R&D: production-shaped browser transcript provider.
 *
 * Fallback chain (to be validated by the R&D results):
 *   1. main_world_intercept  — observe YouTube's own signed caption XHR
 *   2. caption_dom           — scrape rendered captions while playing (lossy)
 *   3. (caller falls back to server-side yt-dlp via the existing API)
 *
 * The provider is written against a small `PageScripting` seam so it can run in
 * the MV3 background worker and be unit-tested with a fake.
 */

import { pageInterceptor, type PageInterceptorConfig } from "./page-interceptor";
import { parseJson3, normalizeSegments, type RawSegment } from "./parseJson3";
import { captureDomCaptions, inspectCaptionTracks, triggerCaptionRequest, type CaptionTrackInfo } from "./methods";
import type { ExtractionMethod } from "./types";

interface RawCapture {
  via: string;
  hasPot: boolean;
  bytes: number;
  paramKeys: string[];
  text: string;
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

const COLLECTOR = () => {
  const w = window as unknown as { __yairRnd?: RawCapture[] };
  if (!Array.isArray(w.__yairRnd)) w.__yairRnd = [];
  return null;
};

/** Ignore absurd/abusive caption payloads (a transcript is never this large). */
export const MAX_CAPTURE_BYTES = 8_000_000;

const READ_CAPTURES = () => {
  const w = window as unknown as { __yairRnd?: RawCapture[] };
  // 8_000_000 must match MAX_CAPTURE_BYTES (function body is serialized alone).
  const caps = (w.__yairRnd || []).filter((c) => c && c.bytes > 0 && c.bytes <= 8_000_000);
  caps.sort((a, b) => b.bytes - a.bytes);
  return caps[0] || null;
};

export interface BrowserProviderOptions {
  prefLang?: string;
  interceptTimeoutMs?: number;
  domFallbackMs?: number;
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
    await this.scripting.injectMainWorld(tabId, COLLECTOR as (...a: never[]) => null, []);
    await this.scripting.evaluateMainWorld(tabId, triggerCaptionRequest as (...a: never[]) => CaptionTrackInfo, [prefLang]);

    const deadline = started + timeoutMs;
    let capture: RawCapture | null = null;
    while (this.now() < deadline) {
      capture = await this.scripting.evaluateMainWorld<RawCapture | null>(tabId, READ_CAPTURES as (...a: never[]) => RawCapture | null, []);
      if (capture?.bytes) break;
      await new Promise((r) => setTimeout(r, 400));
    }

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

    // ---- Fallback: rendered captions (lossy)
    const dom = await this.scripting
      .evaluateMainWorld<Array<{ start: number; text: string }>>(
        tabId,
        captureDomCaptions as unknown as (...a: never[]) => Array<{ start: number; text: string }>,
        [domMs, 1000],
      )
      .catch(() => []);
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
    method: result.method === "caption_dom" ? ("caption_dom" as const) : ("main_world_intercept" as const),
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
