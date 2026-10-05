import { useEffect, useRef, useState } from "react";
import type { ChatController } from "../hooks/useChat";
import { timeAgo } from "../lib/format";
import { BrandMark, RefreshIcon, SendIcon, SparkleIcon, StopIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";

interface ChatTabProps {
  controller: ChatController;
  onSeek: (seconds: number) => void;
  playbackSeconds: number | null;
  ready: boolean;
  guideReady: boolean;
}

export function ChatTab({
  controller,
  onSeek,
  playbackSeconds,
  ready,
  guideReady,
}: ChatTabProps) {
  const { messages, streaming, loaded, error, send, summarize, stop, retry, dismissError } =
    controller;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(120, element.scrollHeight)}px`;
  }, [draft]);

  const submit = () => {
    const text = draft.trim();
    if (!text || streaming || !ready) return;
    setDraft("");
    void send(text);
  };

  const suggestions = [
    "What is this video fundamentally about?",
    "What are the strongest arguments made?",
    playbackSeconds != null
      ? `Explain what was just said around ${Math.floor(playbackSeconds / 60)}:${String(Math.floor(playbackSeconds % 60)).padStart(2, "0")}.`
      : "Summarize the middle section of this video.",
  ];

  return (
    <div className="chat-panel">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          stickRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 90;
        }}
      >
        {!ready ? (
          <div className="banner" style={{ margin: "10px 4px" }}>
            <span className="spinner-inline" />
            <span>Reading the transcript…</span>
          </div>
        ) : !guideReady ? (
          <div className="banner" style={{ margin: "10px 4px" }}>
            <span>
              The full reading guide is still being written in the background — ask anything now.
            </span>
          </div>
        ) : null}
        {!loaded ? null : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="state-icon" style={{ margin: "0 auto" }}>
              <BrandMark size={22} />
            </div>
            <h4>Ask this video anything</h4>
            <p>Answers are grounded in the transcript and cite the moments they come from.</p>
            <button
              type="button"
              className="button primary"
              style={{ margin: "0 auto 14px" }}
              disabled={!ready || streaming}
              onClick={() => void summarize()}
            >
              <SparkleIcon size={14} /> Summarize this video
            </button>
            <div className="suggestions">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="suggestion"
                  disabled={!ready}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div className="msg msg-user" key={message.id}>
                <div className="bubble">{message.content}</div>
              </div>
            ) : (
              <div className="msg msg-assistant" key={message.id}>
                <div className="assistant-head">
                  <BrandMark size={14} className="brand-dot" />
                  <span>AI Reader</span>
                  {message.model ? <span className="muted">· {message.model}</span> : null}
                  <span className="muted">· {timeAgo(message.createdAt)}</span>
                </div>
                {message.content ? (
                  <MarkdownView className="msg-body" markdown={message.content} onSeek={onSeek} />
                ) : message.pending ? (
                  <span className="thinking">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                    <span style={{ marginLeft: 6 }}>Searching the transcript…</span>
                  </span>
                ) : null}
                {message.citations.length > 0 && !message.pending ? (
                  <div className="citations">
                    {message.citations.map((citation, index) => (
                      <button
                        type="button"
                        className="citation"
                        key={`${message.id}-${index}`}
                        title={citation.quote ?? "Jump to this moment"}
                        onClick={() => onSeek(citation.start_seconds)}
                      >
                        <span className="ts-chip" style={{ pointerEvents: "none" }}>
                          {Math.floor(citation.start_seconds / 60)}:
                          {String(Math.floor(citation.start_seconds % 60)).padStart(2, "0")}
                        </span>
                        {citation.quote ? <span className="quote">{citation.quote}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {message.error ? (
                  <div className="banner error" style={{ marginTop: 8, marginBottom: 0 }}>
                    <span>{message.error}</span>
                    <div className="banner-actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => void retry(message.id)}
                        disabled={streaming}
                      >
                        <RefreshIcon size={13} /> Retry
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ),
          )
        )}
      </div>

      <div className="chat-composer">
        {error ? (
          <div className="banner error" style={{ marginBottom: 8 }}>
            <span>{error}</span>
            <div className="banner-actions">
              <button type="button" className="button secondary" onClick={dismissError}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        <div className="composer-box">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            disabled={!ready}
            placeholder={ready ? "Ask about this video…" : "Waiting for the transcript…"}
            aria-label="Ask about this video"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          {streaming ? (
            <button
              type="button"
              className="send-button stop"
              aria-label="Stop generating"
              onClick={stop}
            >
              <StopIcon size={11} />
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              aria-label="Send"
              disabled={!draft.trim() || !ready}
              onClick={submit}
            >
              <SendIcon size={14} />
            </button>
          )}
        </div>
        <div className="composer-hint">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span>{playbackSeconds != null ? `Video at ${Math.floor(playbackSeconds / 60)}:${String(Math.floor(playbackSeconds % 60)).padStart(2, "0")}` : ""}</span>
        </div>
      </div>
    </div>
  );
}
