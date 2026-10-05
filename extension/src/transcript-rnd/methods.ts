/**
 * R&D: self-contained functions that run in the page's MAIN world via
 * `chrome.scripting.executeScript({ world: "MAIN", func })`.
 *
 * These must not reference module imports (Chrome serializes the function body).
 */

export interface CaptionTrackInfo {
  count: number;
  manual: number;
  asr: number;
  languages: string[];
  picked: { languageCode: string; kind: string } | null;
}

interface PlayerLike extends HTMLElement {
  getPlayerResponse?: () => {
    videoDetails?: { title?: string; lengthSeconds?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: {
        captionTracks?: Array<{ languageCode?: string; kind?: string; baseUrl?: string }>;
      };
    };
  };
  getOption?: (namespace: string, option: string) => unknown;
  setOption?: (namespace: string, option: string, value: unknown) => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
}

function player(): PlayerLike | null {
  return document.querySelector("#movie_player") as PlayerLike | null;
}

/** Inspect the player response caption tracks (MAIN world). */
export function inspectCaptionTracks(prefLang = "en"): CaptionTrackInfo {
  const p = player();
  const pr =
    (p && typeof p.getPlayerResponse === "function" ? p.getPlayerResponse() : undefined) ||
    (window as unknown as { ytInitialPlayerResponse?: ReturnType<NonNullable<PlayerLike["getPlayerResponse"]>> })
      .ytInitialPlayerResponse;
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const pick =
    tracks.find((t) => String(t.languageCode || "").startsWith(prefLang) && t.kind !== "asr") ||
    tracks.find((t) => String(t.languageCode || "").startsWith(prefLang)) ||
    tracks[0];
  return {
    count: tracks.length,
    manual: tracks.filter((t) => t.kind !== "asr").length,
    asr: tracks.filter((t) => t.kind === "asr").length,
    languages: tracks.map((t) => String(t.languageCode || "")),
    picked: pick ? { languageCode: String(pick.languageCode || ""), kind: pick.kind || "manual" } : null,
  };
}

/**
 * Turn captions on and start playback so the player issues its own signed
 * `/api/timedtext` request. Toggling the CC control is what reliably triggers a
 * *fresh* request after the interceptor is installed.
 *
 * Self-contained: Chrome serializes only this function body into the MAIN world,
 * so it must not call sibling module functions.
 */
export function triggerCaptionRequest(prefLang = "en"): CaptionTrackInfo {
  const p = document.querySelector("#movie_player") as PlayerLike | null;
  const pr =
    (p && typeof p.getPlayerResponse === "function" ? p.getPlayerResponse() : undefined) ||
    (window as unknown as { ytInitialPlayerResponse?: ReturnType<NonNullable<PlayerLike["getPlayerResponse"]>> })
      .ytInitialPlayerResponse;
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const pick =
    tracks.find((t) => String(t.languageCode || "").startsWith(prefLang) && t.kind !== "asr") ||
    tracks.find((t) => String(t.languageCode || "").startsWith(prefLang)) ||
    tracks[0];
  const info: CaptionTrackInfo = {
    count: tracks.length,
    manual: tracks.filter((t) => t.kind !== "asr").length,
    asr: tracks.filter((t) => t.kind === "asr").length,
    languages: tracks.map((t) => String(t.languageCode || "")),
    picked: pick ? { languageCode: String(pick.languageCode || ""), kind: pick.kind || "manual" } : null,
  };
  try {
    p?.setOption?.("captions", "track", info.picked ? { languageCode: info.picked.languageCode } : { languageCode: prefLang });
  } catch {
    /* ignore */
  }
  document.querySelector(".ytp-subtitles-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  try {
    p?.playVideo?.();
  } catch {
    /* ignore */
  }
  return info;
}

export interface DomCapturedSegment {
  start: number;
  text: string;
}

/**
 * Fallback: capture rendered caption text from the player DOM while playing.
 * Lossy (real-time, may miss/duplicate lines) and timestamped by sampling the
 * current playback position. Returns deduplicated samples.
 */
export function captureDomCaptions(durationMs = 8000, intervalMs = 1000): Promise<DomCapturedSegment[]> {
  return new Promise<DomCapturedSegment[]>((resolve) => {
    const out: DomCapturedSegment[] = [];
    const seen = new Set<string>();
    const video = document.querySelector("video");
    const start = Date.now();
    const timer = window.setInterval(() => {
      const t = video?.currentTime ?? 0;
      const segs = Array.from(document.querySelectorAll(".ytp-caption-segment"))
        .map((n) => n.textContent?.trim() ?? "")
        .filter(Boolean);
      for (const text of segs) {
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({ start: t, text });
      }
      if (Date.now() - start > durationMs) {
        window.clearInterval(timer);
        resolve(out);
      }
    }, intervalMs);
  });
}
