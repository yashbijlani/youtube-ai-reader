import { formatDuration } from "../lib/format";
import type { Chapter } from "../types";
import { TimestampChip } from "./TimestampChip";

interface ChaptersTabProps {
  chapters: Chapter[];
  playbackSeconds: number | null;
  onSeek: (seconds: number) => void;
}

export function ChaptersTab({ chapters, playbackSeconds, onSeek }: ChaptersTabProps) {
  if (chapters.length === 0) {
    return (
      <div className="center-state">
        <p>No chapters were generated for this video.</p>
      </div>
    );
  }

  const activeIndex =
    playbackSeconds == null
      ? -1
      : chapters.reduce(
          (best, chapter, index) =>
            chapter.start_seconds <= playbackSeconds ? index : best,
          -1,
        );

  return (
    <div className="tab-panel">
      {chapters.map((chapter, index) => {
        const duration =
          chapter.end_seconds != null && chapter.end_seconds > chapter.start_seconds
            ? chapter.end_seconds - chapter.start_seconds
            : null;
        return (
          <button
            type="button"
            key={`${chapter.title}-${chapter.start_seconds}`}
            className={`chapter${index === activeIndex ? " active" : ""}`}
            onClick={() => onSeek(chapter.start_seconds)}
          >
            <TimestampChip seconds={chapter.start_seconds} onSeek={onSeek} />
            <span className="chapter-body">
              <span className="chapter-title">{chapter.title}</span>
              {chapter.description ? (
                <span className="chapter-desc">{chapter.description}</span>
              ) : null}
              {duration ? (
                <span className="chapter-duration">{formatDuration(duration)}</span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
