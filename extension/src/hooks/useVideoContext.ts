import { useEffect, useRef, useState } from "react";
import { onMessage, sendMessage } from "../lib/messaging";
import type { VideoContextSnapshot } from "../types";

export interface VideoContextState extends VideoContextSnapshot {
  requestedVideoId: string | null;
  tabId: number | null;
  loaded: boolean;
  extensionAlive: boolean;
}

const INITIAL: VideoContextState = {
  video: null,
  playbackSeconds: null,
  updatedAt: 0,
  requestedVideoId: null,
  tabId: null,
  loaded: false,
  extensionAlive: true,
};

async function resolveTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) return tab.id;
    const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

export function useVideoContext(): VideoContextState {
  const [state, setState] = useState<VideoContextState>(INITIAL);
  const tabIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      const response = await sendMessage<
        VideoContextSnapshot & { requestedVideoId?: string | null; tabId?: number | null }
      >({ type: "GET_CONTEXT", tabId: tabIdRef.current });
      if (cancelled) return;
      if (response) {
        if (response.tabId != null) tabIdRef.current = response.tabId;
        setState((previous) => ({
          ...previous,
          video: response.video,
          playbackSeconds: response.playbackSeconds,
          updatedAt: response.updatedAt,
          requestedVideoId: response.requestedVideoId ?? null,
          tabId: tabIdRef.current,
          loaded: true,
          extensionAlive: true,
        }));
      } else {
        setState((previous) => ({ ...previous, loaded: true, extensionAlive: false }));
      }
    };

    const unsubscribe = onMessage((message) => {
      if (message.type !== "CONTEXT_UPDATED") return;
      // Ignore updates that belong to another tab.
      if (tabIdRef.current != null && message.tabId != null && message.tabId !== tabIdRef.current) {
        return;
      }
      setState({
        video: message.context.video,
        playbackSeconds: message.context.playbackSeconds,
        updatedAt: message.context.updatedAt,
        requestedVideoId: message.requestedVideoId,
        tabId: tabIdRef.current,
        loaded: true,
        extensionAlive: true,
      });
    });

    void (async () => {
      tabIdRef.current = await resolveTabId();
      if (!cancelled) void pull();
    })();

    const timer = window.setInterval(pull, 2500);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
