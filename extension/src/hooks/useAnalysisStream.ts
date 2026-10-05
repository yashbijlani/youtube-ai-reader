import { useEffect, useRef, useState } from "react";
import { analysisStream } from "../lib/api";
import type { Chapter, KeyPoint, VideoInfo } from "../types";

export interface LiveGuide {
  overview: string;
  keyPoints: KeyPoint[];
  chapters: Chapter[];
  reading: string;
  quickRead: string;
  quickReadStreaming: boolean;
  streaming: boolean;
  error: string | null;
}

const EMPTY: LiveGuide = {
  overview: "",
  keyPoints: [],
  chapters: [],
  reading: "",
  quickRead: "",
  quickReadStreaming: false,
  streaming: false,
  error: null,
};

/**
 * Subscribes to the backend's analysis SSE stream so the guide renders
 * token-by-token while it is generated. Falls back gracefully: on error the
 * regular state polling still fills the guide in.
 */
export function useAnalysisStream(
  video: VideoInfo | null,
  apiBaseUrl: string,
  enabled: boolean,
): LiveGuide {
  const [guide, setGuide] = useState<LiveGuide>(EMPTY);
  const sectionsRef = useRef<Record<number, string>>({});
  const videoId = video?.videoId ?? null;

  useEffect(() => {
    sectionsRef.current = {};
    setGuide(EMPTY);
  }, [videoId]);

  useEffect(() => {
    if (!enabled || !videoId) return;
    const controller = new AbortController();
    let cancelled = false;
    sectionsRef.current = {};
    setGuide({ ...EMPTY, streaming: true });

    const join = () =>
      Object.keys(sectionsRef.current)
        .map(Number)
        .sort((a, b) => a - b)
        .map((index) => sectionsRef.current[index])
        .join("\n\n");

    void analysisStream(
      apiBaseUrl,
      videoId,
      {
        onOverview: (overview, keyPoints) => {
          if (!cancelled) setGuide((previous) => ({ ...previous, overview, keyPoints }));
        },
        onChapters: (chapters) => {
          if (!cancelled) setGuide((previous) => ({ ...previous, chapters }));
        },
        onReading: (text) => {
          if (!cancelled) setGuide((previous) => ({ ...previous, reading: text, streaming: false }));
        },
        onReadingSection: (index, text) => {
          sectionsRef.current[index] = text;
          if (!cancelled) setGuide((previous) => ({ ...previous, reading: join() }));
        },
        onReadingDelta: (index, text) => {
          sectionsRef.current[index] = (sectionsRef.current[index] ?? "") + text;
          if (!cancelled) setGuide((previous) => ({ ...previous, reading: join() }));
        },
        onQuickRead: (text) => {
          if (!cancelled)
            setGuide((previous) => ({ ...previous, quickRead: text, quickReadStreaming: false }));
        },
        onQuickReadDelta: (text) => {
          if (!cancelled)
            setGuide((previous) => ({
              ...previous,
              quickRead: previous.quickRead + text,
              quickReadStreaming: true,
            }));
        },
        onDone: () => {
          if (!cancelled) setGuide((previous) => ({ ...previous, streaming: false }));
        },
        onError: (error) => {
          if (!cancelled) setGuide((previous) => ({ ...previous, streaming: false, error: error.message }));
        },
      },
      controller.signal,
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, videoId, apiBaseUrl]);

  return guide;
}
