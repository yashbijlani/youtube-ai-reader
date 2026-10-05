import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { formatTimestamp } from "../lib/format";
import type { Transcript } from "../types";
import { ChevronIcon, SearchIcon } from "./Icons";
import { TimestampChip } from "./TimestampChip";

interface TranscriptTabProps {
  transcript: Transcript;
  playbackSeconds: number | null;
  onSeek: (seconds: number) => void;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    count += 1;
    position = haystack.indexOf(needle, position + needle.length);
  }
  return count;
}

function renderHighlighted(
  text: string,
  query: string,
  offset: number,
  activeGlobal: number,
): ReactElement {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: Array<string | { hit: string; index: number }> = [];
  let cursor = 0;
  let localIndex = 0;
  let position = lower.indexOf(query);
  while (position !== -1) {
    if (position > cursor) parts.push(text.slice(cursor, position));
    parts.push({ hit: text.slice(position, position + query.length), index: localIndex });
    localIndex += 1;
    cursor = position + query.length;
    position = lower.indexOf(query, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <mark
            key={index}
            className={offset + part.index === activeGlobal ? "active" : undefined}
          >
            {part.hit}
          </mark>
        ),
      )}
    </>
  );
}

export function TranscriptTab({ transcript, playbackSeconds, onSeek }: TranscriptTabProps) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const needle = query.trim().toLowerCase();
  const searching = needle.length >= 2;

  const matches = useMemo(() => {
    if (!searching) return [];
    return transcript.segments
      .map((segment, index) => (segment.text.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
  }, [needle, searching, transcript.segments]);

  const prefixCounts = useMemo(() => {
    const counts = new Array<number>(transcript.segments.length + 1).fill(0);
    if (!searching) return counts;
    for (let index = 0; index < transcript.segments.length; index += 1) {
      counts[index + 1] =
        counts[index] + countOccurrences(transcript.segments[index].text.toLowerCase(), needle);
    }
    return counts;
  }, [needle, searching, transcript.segments]);

  useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  useEffect(() => {
    if (matches.length === 0) return;
    const target = scrollRef.current?.querySelector<HTMLElement>(
      `[data-match="${matches[Math.min(activeMatch, matches.length - 1)]}"]`,
    );
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatch, matches]);

  const currentSegmentIndex = useMemo(() => {
    if (playbackSeconds == null) return -1;
    return transcript.segments.findIndex(
      (segment) => playbackSeconds >= segment.start && playbackSeconds <= segment.end,
    );
  }, [playbackSeconds, transcript.segments]);

  const activeSegmentIndex = matches[Math.min(activeMatch, Math.max(0, matches.length - 1))];
  const activeGlobal =
    searching && matches.length > 0 ? prefixCounts[activeSegmentIndex] ?? 0 : -1;

  return (
    <div className="tab-panel" ref={scrollRef}>
      <div className="transcript-toolbar">
        <div className="search-field">
          <SearchIcon size={13} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (matches.length === 0) return;
                const delta = event.shiftKey ? -1 : 1;
                setActiveMatch((previous) => {
                  const next = previous + delta;
                  if (next < 0) return matches.length - 1;
                  return next % matches.length;
                });
              }
            }}
            placeholder="Search transcript…"
            aria-label="Search transcript"
          />
          {searching ? (
            <>
              <span className="search-count">
                {matches.length === 0
                  ? "0/0"
                  : `${Math.min(activeMatch + 1, matches.length)}/${matches.length}`}
              </span>
              <button
                type="button"
                className="icon-button"
                style={{ width: 24, height: 24 }}
                disabled={matches.length === 0}
                aria-label="Previous match"
                onClick={() =>
                  setActiveMatch((previous) =>
                    matches.length === 0 ? 0 : (previous - 1 + matches.length) % matches.length,
                  )
                }
              >
                <ChevronIcon size={12} direction="up" />
              </button>
              <button
                type="button"
                className="icon-button"
                style={{ width: 24, height: 24 }}
                disabled={matches.length === 0}
                aria-label="Next match"
                onClick={() =>
                  setActiveMatch((previous) =>
                    matches.length === 0 ? 0 : (previous + 1) % matches.length,
                  )
                }
              >
                <ChevronIcon size={12} direction="down" />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {transcript.segments.map((segment, index) => {
        const isMatch = matches.includes(index);
        return (
          <div
            key={`${segment.start}-${index}`}
            className={`segment${index === currentSegmentIndex ? " current" : ""}${isMatch ? " hit" : ""}`}
            data-match={isMatch ? index : undefined}
            title={`Jump to ${formatTimestamp(segment.start)}`}
          >
            <TimestampChip seconds={segment.start} onSeek={onSeek} showIcon={false} />
            <span className="segment-text">
              {renderHighlighted(
                segment.text,
                searching ? needle : "",
                searching ? prefixCounts[index] ?? 0 : 0,
                activeGlobal,
              )}
            </span>
          </div>
        );
      })}
      <p className="muted small" style={{ marginTop: 12 }}>
        {transcript.language ? `Language: ${transcript.language} · ` : ""}
        {transcript.kind === "auto" ? "Auto-generated captions" : "Creator captions"} ·{" "}
        {transcript.segments.length} lines
      </p>
    </div>
  );
}
