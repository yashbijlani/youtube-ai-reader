export interface VideoInfo {
  videoId: string;
  url: string;
  title?: string;
  channel?: string;
  duration?: number;
}

export interface VideoContextSnapshot {
  video: VideoInfo | null;
  playbackSeconds: number | null;
  updatedAt: number;
}

export interface KeyPoint {
  title: string;
  explanation: string;
  start_seconds: number | null;
}

export interface Chapter {
  title: string;
  description?: string | null;
  start_seconds: number;
  end_seconds?: number | null;
}

export interface Analysis {
  overview: string;
  key_points: KeyPoint[];
  chapters: Chapter[];
  detailed_reading: string;
  generated_by?: string | null;
  prompt_version?: number | null;
  degraded: boolean;
  degraded_reason?: string | null;
}

export interface VideoMeta {
  video_id: string;
  url: string;
  title: string;
  channel?: string | null;
  duration?: number | null;
  thumbnail?: string | null;
  language?: string | null;
  subtitle_kind?: "manual" | "auto" | "none" | null;
}

export interface ErrorInfo {
  code: string;
  message: string;
}

export type JobStatus = "idle" | "processing" | "ready" | "error";
export type AnalysisStatus = "pending" | "partial" | "ready" | "error";

export interface VideoState {
  video_id: string;
  status: JobStatus;
  stage?: string | null;
  stage_message?: string | null;
  error?: ErrorInfo | null;
  metadata?: VideoMeta | null;
  transcript_available?: boolean | null;
  analysis_status: AnalysisStatus;
  analysis?: Analysis | null;
  cached: boolean;
  processed_at?: string | null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  video_id: string;
  language?: string | null;
  kind: string;
  segments: TranscriptSegment[];
}

export interface Citation {
  start_seconds: number;
  end_seconds?: number | null;
  quote?: string | null;
}

export interface ChatUsage {
  model?: string | null;
  input_chars?: number;
  output_chars?: number;
  latency_ms?: number;
}

export interface ChatResponse {
  answer: string;
  citations: Citation[];
  usage?: ChatUsage;
}

export interface HealthInfo {
  status: string;
  version: string;
  ai_configured: boolean;
  model: string;
  fast_model?: string;
}

export interface UsageInfo {
  used: number;
  limit: number;
  paid: boolean;
  remaining: number;
}

export interface AccountInfo {
  authenticated: boolean;
  user: { id: string; email?: string | null; plan?: string } | null;
  subscription: {
    status: string;
    plan: string;
    current_period_end?: string | null;
    active: boolean;
  } | null;
  usage: {
    period: string;
    videos_used: number;
    chat_messages: number;
    ai_cost_usd: number;
    lifetime_videos: number;
    free_limit: number;
    free_monthly_limit: number;
  };
}

export interface BillingOrder {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  plan_name: string;
}

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  createdAt: number;
  pending?: boolean;
  error?: string | null;
  model?: string | null;
}

export interface Conversation {
  videoId: string;
  title?: string;
  messages: StoredMessage[];
  updatedAt: number;
}

export type TabId = "overview" | "chat";

// ---------------------------------------------------------------- messaging

export type ContentToBackground =
  | { type: "VIDEO_CHANGED"; video: VideoInfo | null }
  | { type: "PLAYBACK_TIME"; videoId: string; seconds: number }
  | { type: "READ_WITH_AI_REQUESTED"; video: VideoInfo }
  | {
      type: "CAPTION_CAPTURED";
      videoId: string | null;
      text: string;
      hasPot: boolean;
      bytes: number;
      paramKeys: string[];
    };

export type PanelToBackground =
  | { type: "GET_CONTEXT"; tabId?: number | null }
  | { type: "GET_CLIENT_TRANSCRIPT"; videoId: string }
  | { type: "EXTRACT_CLIENT_TRANSCRIPT"; videoId: string; tabId?: number | null }
  | { type: "SEEK_TO"; seconds: number; videoId?: string; tabId?: number | null }
  | { type: "CONSUME_REQUEST"; tabId?: number | null }
  | { type: "OPEN_PANEL"; tabId?: number | null };

export interface ClientTranscriptPayload {
  videoId: string;
  language: string;
  kind: "manual" | "auto";
  format: "json3" | "segments";
  content?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  method?: "browser_intercept" | "caption_dom";
}

/** Result of an awaited browser transcript extraction. */
export type TranscriptExtractionResult =
  | { status: "ok"; payload: ClientTranscriptPayload }
  | { status: "no_captions" }
  | { status: "error"; message?: string };

export type BackgroundToContent = { type: "SEEK_TO"; seconds: number };

export type BackgroundBroadcast = {
  type: "CONTEXT_UPDATED";
  tabId: number | null;
  context: VideoContextSnapshot;
  requestedVideoId: string | null;
};

export type RuntimeMessage =
  | ContentToBackground
  | PanelToBackground
  | BackgroundToContent
  | BackgroundBroadcast
  | { type: "PING" };
