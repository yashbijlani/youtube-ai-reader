import { useEffect, useState } from "react";
import { onMessage, sendMessage } from "../lib/messaging";
import type { VideoContextSnapshot } from "../types";

export interface VideoContextState extends VideoContextSnapshot {
  requestedVideoId: string | null;
  loaded: boolean;
  extensionAlive: boolean;
}

const INITIAL: VideoContextState = {
  video: null,
  playbackSeconds: null,
  updatedAt: 0,
  requestedVideoId: null,
  loaded: false,
  extensionAlive: true,
};

export function useVideoContext(): VideoContextState {
  const [state, setState] = useState<VideoContextState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      const response = await sendMessage<VideoContextSnapshot & { requestedVideoId?: string | null }>(
        { type: "GET_CONTEXT" },
      );
      if (cancelled) return;
      if (response) {
        setState((previous) => ({
          ...previous,
          video: response.video,
          playbackSeconds: response.playbackSeconds,
          updatedAt: response.updatedAt,
          requestedVideoId: response.requestedVideoId ?? null,
          loaded: true,
          extensionAlive: true,
        }));
      } else {
        setState((previous) => ({ ...previous, loaded: true, extensionAlive: false }));
      }
    };

    void pull();
    const unsubscribe = onMessage((message) => {
      if (message.type === "CONTEXT_UPDATED") {
        setState({
          video: message.context.video,
          playbackSeconds: message.context.playbackSeconds,
          updatedAt: message.context.updatedAt,
          requestedVideoId: message.requestedVideoId,
          loaded: true,
          extensionAlive: true,
        });
      }
    });
    const timer = window.setInterval(pull, 2500);
    return () => {
      cancelled = true;
      unsubscribe();
      window.clearInterval(timer);
    };
  }, []);

  return state;
}
