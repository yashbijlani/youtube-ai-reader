import { useEffect, useState } from "react";
import { SparkleIcon } from "./Icons";

const STAGES: Array<[string, string]> = [
  ["fetching_metadata", "Getting video information"],
  ["fetching_transcript", "Finding transcript"],
  ["preparing", "Reading transcript"],
  ["summarizing", "Understanding the video"],
  ["chapters", "Building chapters"],
  ["writing", "Writing the detailed reading"],
];

interface LoadingViewProps {
  stage: string | null | undefined;
  stageMessage: string | null | undefined;
  onCancel?: () => void;
  busy?: boolean;
}

export function LoadingView({ stage, stageMessage, onCancel, busy }: LoadingViewProps) {
  const [elapsed, setElapsed] = useState(0);
  const currentIndex = STAGES.findIndex(([key]) => key === stage);
  const allDone = stage === "ready";

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="loading-card">
      <div className="loading-head">
        <span className="loading-pulse">
          <SparkleIcon size={16} />
        </span>
        <div style={{ flex: 1 }}>
          <div className="loading-title">{stageMessage ?? "Working on it…"}</div>
          <div className="loading-sub">
            {elapsed}s elapsed · YouTube sometimes throttles transcript downloads
          </div>
        </div>
        {onCancel ? (
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : null}
      </div>
      <ul className="stage-list">
        {STAGES.map(([key, label], index) => {
          const done = allDone || (currentIndex >= 0 && index < currentIndex);
          const active = !allDone && index === currentIndex;
          return (
            <li key={key} className={`stage${done ? " done" : ""}${active ? " active" : ""}`}>
              <span className="marker">{done ? "✓" : ""}</span>
              {label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
