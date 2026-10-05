import type { TranscriptExtractionResult } from "../types";

/**
 * Whether an awaited browser extraction produced a usable transcript.
 * When false, the caller falls back to server-side processing.
 */
export function hasBrowserTranscript(
  result: TranscriptExtractionResult | null | undefined,
): boolean {
  if (!result || result.status !== "ok") return false;
  const { content, segments } = result.payload;
  return Boolean(content || segments?.length);
}
