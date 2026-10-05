import type { VideoInfo } from "../types";
import { extractVideoId, watchUrlFor } from "./youtube";

/** Whether a tab URL points at a supported YouTube video. */
export function isYouTubeUrl(url: string | null | undefined): boolean {
  return extractVideoId(url) !== null;
}

/** Build a minimal VideoInfo from a tab URL (no title until the page reports). */
export function videoInfoFromUrl(url: string | null | undefined): VideoInfo | null {
  const id = extractVideoId(url);
  if (!id) return null;
  return { videoId: id, url: watchUrlFor(id) };
}

/**
 * Resolve which video a tab is actually showing.
 *
 * The tab URL is authoritative: a stored/restored context is only trusted when
 * it agrees with the URL. This prevents a stale background context (e.g. after
 * an MV3 service-worker restart) from binding the side panel to a previous
 * video.
 */
export function resolveVideoInfo(
  stored: VideoInfo | null | undefined,
  tabUrl: string | null | undefined,
): VideoInfo | null {
  const fromUrl = videoInfoFromUrl(tabUrl);
  if (!fromUrl) return null;
  if (stored && stored.videoId === fromUrl.videoId) {
    return { ...stored, url: stored.url || fromUrl.url };
  }
  return fromUrl;
}
