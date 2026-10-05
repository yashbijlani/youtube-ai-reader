import { useState } from "react";
import type { Analysis, AnalysisStatus, Chapter, Transcript } from "../types";
import { ChaptersTab } from "./ChaptersTab";
import { AlertIcon, ChevronIcon, TextIcon } from "./Icons";
import { MarkdownView } from "./MarkdownView";
import { TimestampChip } from "./TimestampChip";
import { TranscriptTab } from "./TranscriptTab";

interface OverviewTabProps {
  analysis: Analysis | null;
  analysisStatus: AnalysisStatus;
  onSeek: (seconds: number) => void;
  onReprocess: () => void;
  reprocessing: boolean;
  streamingReading?: boolean;
  quickRead?: string;
  quickReadStreaming?: boolean;
  chapters?: Chapter[];
  transcript?: Transcript | null;
  playbackSeconds?: number | null;
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className="skeleton-line"
          style={{ width: `${100 - index * 12}%` }}
        />
      ))}
    </div>
  );
}

export function OverviewTab({
  analysis,
  analysisStatus,
  onSeek,
  onReprocess,
  reprocessing,
  streamingReading = false,
  quickRead = "",
  quickReadStreaming = false,
  chapters = [],
  transcript = null,
  playbackSeconds = null,
}: OverviewTabProps) {
  const [showTranscript, setShowTranscript] = useState(false);
  const working = analysisStatus === "pending" || analysisStatus === "partial";
  const failed = analysisStatus === "error";
  const hasOverview = Boolean(analysis?.overview);
  const hasReading = Boolean(analysis?.detailed_reading);

  return (
    <div className="tab-panel">
      {analysis?.degraded ? (
        <div className="banner warning">
          <AlertIcon size={14} />
          <div>
            <strong>Partial analysis.</strong>{" "}
            {analysis.degraded_reason ?? "Some parts could not be generated."}
          </div>
          <div className="banner-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onReprocess}
              disabled={reprocessing}
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {failed && !hasOverview ? (
        <div className="banner error">
          <AlertIcon size={14} />
          <div>
            The reading guide couldn't be generated. You can still ask questions in Chat, or try
            reprocessing.
          </div>
          <div className="banner-actions">
            <button
              type="button"
              className="button secondary"
              onClick={onReprocess}
              disabled={reprocessing}
            >
              Reprocess
            </button>
          </div>
        </div>
      ) : null}

      {quickRead ? (
        <>
          <h2 className="section-title">Quick read</h2>
          <MarkdownView markdown={quickRead} onSeek={onSeek} />
          {quickReadStreaming ? (
            <div className="overview-pending">
              <span className="spinner-inline" />
              <span>Reading…</span>
            </div>
          ) : null}
        </>
      ) : null}

      {hasOverview ? (
        <p className="lede">{analysis?.overview}</p>
      ) : working ? (
        <div className="overview-pending">
          <span className="spinner-inline" />
          <span>Preparing the overview…</span>
        </div>
      ) : null}

      {analysis && analysis.key_points.length > 0 ? (
        <>
          <h2 className="section-title">Key ideas</h2>
          {analysis.key_points.map((point, index) => (
            <article className="keypoint" key={`${point.title}-${index}`}>
              <div className="keypoint-head">
                <span className="keypoint-index">{index + 1}</span>
                <h3 className="keypoint-title">{point.title}</h3>
                <TimestampChip seconds={point.start_seconds} onSeek={onSeek} />
              </div>
              <p>{point.explanation}</p>
            </article>
          ))}
        </>
      ) : working && hasOverview ? (
        <>
          <h2 className="section-title">Key ideas</h2>
          <Skeleton lines={3} />
        </>
      ) : null}

      <h2 className="section-title">Chapters</h2>
      {chapters.length > 0 ? (
        <ChaptersTab chapters={chapters} playbackSeconds={playbackSeconds} onSeek={onSeek} />
      ) : working ? (
        <Skeleton lines={4} />
      ) : (
        <p className="muted">No chapters were generated for this video.</p>
      )}

      {hasReading ? (
        <>
          <h2 className="section-title">Detailed reading</h2>
          <MarkdownView markdown={analysis?.detailed_reading ?? ""} onSeek={onSeek} />
          {streamingReading ? (
            <div className="overview-pending">
              <span className="spinner-inline" />
              <span>Still writing…</span>
            </div>
          ) : null}
        </>
      ) : working ? (
        <>
          <h2 className="section-title">Detailed reading</h2>
          <div className="overview-pending">
            <span className="spinner-inline" />
            <span>Writing the detailed reading… this appears as it's written.</span>
          </div>
          <Skeleton lines={5} />
        </>
      ) : null}

      {transcript ? (
        <>
          <button
            type="button"
            className="transcript-toggle"
            aria-expanded={showTranscript}
            onClick={() => setShowTranscript((value) => !value)}
          >
            <TextIcon size={13} />
            <span>{showTranscript ? "Hide transcript" : "View transcript"}</span>
            <span className="muted small">{transcript.segments.length} lines</span>
            <ChevronIcon size={13} direction={showTranscript ? "up" : "down"} />
          </button>
          {showTranscript ? (
            <TranscriptTab
              transcript={transcript}
              playbackSeconds={playbackSeconds}
              onSeek={onSeek}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
