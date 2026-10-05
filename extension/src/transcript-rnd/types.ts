/** Shared types for the transcript R&D harness. */

export type ExtractionMethod =
  | "player_response_fetch" // Method A
  | "main_world_intercept" // Method C (extension-viable)
  | "caption_dom" // Method D
  | "transcript_panel" // Method F
  | "server_ytdlp"; // Method I

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ExtractionResult {
  videoId: string;
  method: ExtractionMethod;
  success: boolean;
  latencyMs: number;
  segmentCount: number;
  characterCount: number;
  wordCount: number;
  timestamped: boolean;
  language: string | null;
  firstTimestamp: number | null;
  lastTimestamp: number | null;
  error: string | null;
  /** Non-sensitive diagnostic info. */
  sourceInfo?: Record<string, unknown>;
}

export interface PageCaptionMessage {
  source: string;
  token: string;
  type: "caption";
  via: string;
  paramKeys: string[];
  hasPot: boolean;
  bytes: number;
  text: string;
}
