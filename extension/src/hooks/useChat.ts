import { useCallback, useEffect, useRef, useState } from "react";
import { askStream, summarizeStream, type StreamHandlers } from "../lib/api";
import {
  clearConversation,
  loadConversation,
  newMessage,
  saveConversation,
} from "../lib/chatStore";
import { truncate } from "../lib/format";
import type { StoredMessage, VideoInfo } from "../types";

export interface ChatController {
  messages: StoredMessage[];
  streaming: boolean;
  loaded: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  summarize: () => Promise<void>;
  stop: () => void;
  retry: (messageId: string) => Promise<void>;
  clear: () => Promise<void>;
  dismissError: () => void;
}

type StreamRunner = (handlers: StreamHandlers, signal: AbortSignal) => Promise<void>;

export function useChat(
  video: VideoInfo | null,
  apiBaseUrl: string,
  playbackSeconds: number | null,
): ChatController {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const videoId = video?.videoId ?? null;
  const videoTitle = video?.title;

  // Load the per-video conversation.
  useEffect(() => {
    let cancelled = false;
    abortRef.current?.abort();
    setMessages([]);
    setStreaming(false);
    setError(null);
    setLoaded(false);
    if (!videoId) {
      setLoaded(true);
      return;
    }
    void loadConversation(videoId)
      .then((conversation) => {
        if (!cancelled) {
          setMessages(conversation?.messages ?? []);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [videoId]);

  const persist = useCallback(
    (next: StoredMessage[]) => {
      if (!videoId) return;
      void saveConversation({
        videoId,
        title: videoTitle,
        messages: next,
        updatedAt: Date.now(),
      }).catch(() => undefined);
    },
    [videoId, videoTitle],
  );

  const streamAssistant = useCallback(
    async (base: StoredMessage[], runner: StreamRunner, assistantId?: string) => {
      if (!videoId) return;
      const assistant = newMessage({
        id: assistantId,
        role: "assistant",
        content: "",
        citations: [],
        pending: true,
      });
      const next = [...base, assistant];
      setMessages(next);
      persist(next);
      setStreaming(true);
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      let content = "";
      await runner(
        {
          onDelta: (delta) => {
            content += delta;
            setMessages((previous) =>
              previous.map((message) =>
                message.id === assistant.id ? { ...message, content } : message,
              ),
            );
          },
          onDone: (citations, usage) => {
            setMessages((previous) => {
              const done = previous.map((message) =>
                message.id === assistant.id
                  ? {
                      ...message,
                      content,
                      citations,
                      pending: false,
                      model: usage?.model ?? null,
                    }
                  : message,
              );
              persist(done);
              return done;
            });
            setStreaming(false);
          },
          onError: (apiError) => {
            setError(apiError.message);
            setMessages((previous) => {
              const failed = previous.map((message) =>
                message.id === assistant.id
                  ? { ...message, content, pending: false, error: apiError.message }
                  : message,
              );
              persist(failed);
              return failed;
            });
            setStreaming(false);
          },
        },
        controller.signal,
      );
      if (abortRef.current === controller) {
        abortRef.current = null;
        setStreaming(false);
      }
    },
    [persist, videoId],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!videoId || !trimmed || streaming) return;
      const userMessage = newMessage({ role: "user", content: trimmed, citations: [] });
      const base = [...messages, userMessage];
      setMessages(base);
      persist(base);
      const history = base
        .filter((message) => !message.error && message.content.trim())
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: truncate(message.content, 1600),
        }));
      await streamAssistant(base, (handlers, signal) =>
        askStream(
          apiBaseUrl,
          videoId,
          { message: trimmed, history, current_time_seconds: playbackSeconds },
          handlers,
          signal,
        ),
      );
    },
    [apiBaseUrl, messages, persist, playbackSeconds, streamAssistant, streaming, videoId],
  );

  const summarize = useCallback(async () => {
    if (!videoId || streaming) return;
    await streamAssistant(messages, (handlers, signal) =>
      summarizeStream(apiBaseUrl, videoId, handlers, signal),
    );
  }, [apiBaseUrl, messages, streamAssistant, streaming, videoId]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((previous) => {
      const next = previous.map((message) =>
        message.pending ? { ...message, pending: false } : message,
      );
      persist(next);
      return next;
    });
  }, [persist]);

  const retry = useCallback(
    async (messageId: string) => {
      if (streaming) return;
      const index = messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      let userIndex = -1;
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].role === "user") {
          userIndex = i;
          break;
        }
      }
      const base = messages.slice(0, index);
      if (userIndex < 0) {
        // Retrying a failed summary (no user turn before it).
        await streamAssistant(base, (handlers, signal) =>
          summarizeStream(apiBaseUrl, videoId ?? "", handlers, signal),
        );
        return;
      }
      const history = base
        .filter((message) => !message.error && message.content.trim())
        .slice(-8)
        .map((message) => ({
          role: message.role,
          content: truncate(message.content, 1600),
        }));
      await streamAssistant(base, (handlers, signal) =>
        askStream(
          apiBaseUrl,
          videoId ?? "",
          {
            message: messages[userIndex].content,
            history,
            current_time_seconds: playbackSeconds,
          },
          handlers,
          signal,
        ),
      );
    },
    [apiBaseUrl, messages, playbackSeconds, streamAssistant, streaming, videoId],
  );

  const clear = useCallback(async () => {
    if (!videoId) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages([]);
    setError(null);
    await clearConversation(videoId).catch(() => undefined);
  }, [videoId]);

  const dismissError = useCallback(() => setError(null), []);

  return {
    messages,
    streaming,
    loaded,
    error,
    send,
    summarize,
    stop,
    retry,
    clear,
    dismissError,
  };
}
