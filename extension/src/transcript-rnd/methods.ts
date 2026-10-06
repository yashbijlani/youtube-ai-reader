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

/** Inspect the player response caption tracks (MAIN world, self-contained). */
export function inspectCaptionTracks(prefLang = "en"): CaptionTrackInfo {
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
export async function triggerCaptionRequest(prefLang = "en"): Promise<CaptionTrackInfo> {
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
  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    p?.setOption?.("captions", "track", info.picked ? { languageCode: info.picked.languageCode } : { languageCode: prefLang });
  } catch {
    /* ignore */
  }
  await wait(60);
  const button = document.querySelector(".ytp-subtitles-button") as HTMLElement | null;
  const click = () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  // Toggling CC is what forces a *fresh* signed caption request after the
  // interceptor is installed. Never leave captions off: if they are already on,
  // toggle off then back on so a new request still fires and ends enabled.
  if (button?.getAttribute("aria-pressed") === "true") {
    click();
    await wait(140);
    click();
  } else {
    click();
  }
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
 * Fallback: open YouTube's own transcript panel and scrape its segments. Uses the
 * user's session, needs no playback, and reflects the *current* video (unlike a
 * cached player response). Self-contained: serialized into the MAIN world.
 */
export function captureTranscriptPanel(timeoutMs = 12000): Promise<DomCapturedSegment[]> {
  return new Promise<DomCapturedSegment[]>((resolve) => {
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const clean = (value: string | null | undefined) => (value || "").replace(/\s+/g, " ").trim();
    const parseStamp = (raw: string): number | null => {
      const parts = clean(raw)
        .split(":")
        .map((p) => Number.parseInt(p, 10));
      if (!parts.length || parts.some((n) => Number.isNaN(n))) return null;
      return parts.reduce((acc, n) => acc * 60 + n, 0);
    };
    const transcriptControl = (): HTMLElement | null => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>(
          "button, yt-button-shape, ytd-button-renderer, tp-yt-paper-item, ytd-menu-service-item-renderer",
        ),
      );
      return (
        nodes.find((el) => /transcript/i.test(el.getAttribute("aria-label") || "")) ||
        nodes.find((el) => /transcript/i.test(el.textContent || "")) ||
        null
      );
    };
    const readSegments = (): DomCapturedSegment[] => {
      const out: DomCapturedSegment[] = [];
      // Classic transcript panel.
      for (const node of Array.from(
        document.querySelectorAll<HTMLElement>("ytd-transcript-segment-renderer"),
      )) {
        const stamp = node.querySelector<HTMLElement>(".segment-timestamp");
        const text = clean(node.querySelector<HTMLElement>(".segment-text")?.textContent || "");
        const start = stamp ? parseStamp(stamp.textContent || "") : null;
        if (text && start != null) out.push({ start, text });
      }
      // Modern transcript view (`PAmodern_transcript_view`).
      for (const node of Array.from(
        document.querySelectorAll<HTMLElement>("transcript-segment-view-model"),
      )) {
        const stamp = node.querySelector<HTMLElement>(".ytwTranscriptSegmentViewModelTimestamp");
        const text = clean(
          node.querySelector<HTMLElement>(".ytAttributedStringHost")?.textContent || "",
        );
        const start = stamp ? parseStamp(stamp.textContent || "") : null;
        if (text && start != null) out.push({ start, text });
      }
      return out;
    };

    void (async () => {
      const deadline = Date.now() + timeoutMs;
      if (readSegments().length) {
        resolve(readSegments());
        return;
      }
      document
        .querySelector<HTMLElement>(
          "tp-yt-paper-button#expand, ytd-text-inline-expander #expand, #description-inline-expander #expand",
        )
        ?.click?.();
      await sleep(300);
      let control = transcriptControl();
      if (!control) {
        const more = Array.from(document.querySelectorAll<HTMLElement>("button")).find((b) =>
          /more|action|overflow/i.test(b.getAttribute("aria-label") || ""),
        );
        more?.click?.();
        await sleep(300);
        control = transcriptControl();
      }
      control?.click?.();
      while (Date.now() < deadline) {
        const segs = readSegments();
        if (segs.length) {
          resolve(segs);
          return;
        }
        await sleep(300);
      }
      resolve([]);
    })();
  });
}

/** Media duration in seconds (MAIN world, self-contained). 0 when unknown. */
export function getMediaDuration(): number {
  const video = document.querySelector("video");
  const duration = video?.duration;
  return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : 0;
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
