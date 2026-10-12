import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { sendMessage } from "../lib/messaging";
import { hasBrowserTranscript } from "../lib/transcript";
import type { TranscriptExtractionResult, VideoInfo, VideoState } from "../types";

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError("unknown_error", "Something went wrong.");
}

const LIMIT_CODES = ["free_limit_reached", "quota_exceeded", "subscription_required"];

export interface VideoReader {
  state: VideoState | null;
  error: ApiError | null;
  starting: boolean;
  limitReached: boolean;
  process: (force?: boolean) => Promise<void>;
  repair: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
  clearLimitReached: () => void;
}

export function useVideoReader(
  video: VideoInfo | null,
  apiBaseUrl: string,
  requestedVideoId: string | null,
  panelTabId: number | null,
): VideoReader {
  const [state, setState] = useState<VideoState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [starting, setStarting] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const generationRef = useRef(0);
  const videoId = video?.videoId ?? null;

  const refresh = useCallback(async () => {
    if (!videoId) {
      setState(null);
      return;
    }
    try {
      const next = await api.getVideoState(apiBaseUrl, videoId);
      setState(next);
      setError(null);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.status === 404) {
        setState(null);
        setError(null);
      } else {
        setError(apiError);
      }
    }
  }, [apiBaseUrl, videoId]);

  const process = useCallback(
    async (force = false) => {
      if (!video) return;
      setStarting(true);
      setError(null);
      setLimitReached(false);
      try {
        if (!force) {
          // Await the browser capture so we never fall back to server YouTube
          // fetching when the user's own session already has the captions.
          const extraction = await sendMessage<TranscriptExtractionResult | null>({
            type: "EXTRACT_CLIENT_TRANSCRIPT",
            videoId: video.videoId,
            tabId: panelTabId,
          });
          const client =
            extraction &&
            extraction.status === "ok" &&
            hasBrowserTranscript(extraction) &&
            extraction.payload.videoId === video.videoId
              ? extraction.payload
              : null;
          console.log(
            "[yair] extract",
            extraction?.status ?? "no-response",
            "method=" + (client?.method ?? "-"),
            "bytes=" + (client?.content?.length ?? client?.segments?.length ?? 0),
          );
          if (client) {
            try {
              const next = await api.ingest(apiBaseUrl, video.videoId, {
                title: client.title ?? video.title,
                channel: video.channel,
                duration: video.duration,
                language: client.language,
                kind: client.kind,
                format: client.format,
                content: client.content,
                segments: client.segments,
                method: client.method,
              });
              console.log("[yair] ingest ok", video.videoId, next.status, next.stage);
              setState(next);
              return;
            } catch (err) {
              const apiError = toApiError(err);
              if (apiError.code.startsWith("ai_")) {
                setError(apiError);
                return;
              }
              if (LIMIT_CODES.includes(apiError.code)) {
                setLimitReached(true);
                return;
              }
              if (apiError.code === "unauthorized") {
                setError(apiError);
                return;
              }
              console.warn(
                "[yair] ingest failed; falling back to server processing",
                apiError.code,
                apiError.message,
              );
              // Otherwise fall back to server-side processing.
            }
          }
        }
        console.warn("[yair] using server-side processing for", video.videoId, "(force=" + force + ")");
        const next = await api.processVideo(apiBaseUrl, video.url, force);
        setState(next);
      } catch (err) {
        const apiError = toApiError(err);
        if (LIMIT_CODES.includes(apiError.code)) {
          setLimitReached(true);
        } else {
          setError(apiError);
        }
      } finally {
        setStarting(false);
      }
    },
    [apiBaseUrl, video, panelTabId],
  );

  // Load state when the video changes.
  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    setState(null);
    setError(null);
    setLimitReached(false);
    if (!videoId) return;
    void (async () => {
      try {
        const next = await api.getVideoState(apiBaseUrl, videoId);
        if (generation === generationRef.current) setState(next);
      } catch (err) {
        if (generation !== generationRef.current) return;
        const apiError = toApiError(err);
        if (apiError.status !== 404) setError(apiError);
      }
    })();
  }, [apiBaseUrl, videoId]);

  // The in-page button asked us to read this video.
  useEffect(() => {
    if (!video || !requestedVideoId || requestedVideoId !== video.videoId) return;
    if (starting) return;
    if (state?.status === "processing" || state?.status === "ready") {
      void sendMessage({ type: "CONSUME_REQUEST", tabId: panelTabId });
      return;
    }
    void sendMessage({ type: "CONSUME_REQUEST", tabId: panelTabId });
    void process(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedVideoId, video?.videoId]);

  // Poll while the transcript is loading or the guide is still being written.
  useEffect(() => {
    if (!videoId) return;
    const stillWorking = state?.status === "processing";
    const guideWorking =
      state?.status === "ready" && (state.analysis_status === "pending" || state.analysis_status === "partial");
    if (!stillWorking && !guideWorking) return;
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => window.clearInterval(timer);
  }, [state?.status, state?.analysis_status, videoId, refresh]);

  const clearError = useCallback(() => setError(null), []);
  const clearLimitReached = useCallback(() => setLimitReached(false), []);

  const repair = useCallback(async () => {
    if (!video) return;
    setStarting(true);
    setError(null);
    try {
      const next = await api.repair(apiBaseUrl, video.videoId);
      setState(next);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setStarting(false);
    }
  }, [apiBaseUrl, video]);

  return { state, error, starting, limitReached, process, repair, refresh, clearError, clearLimitReached };
}
