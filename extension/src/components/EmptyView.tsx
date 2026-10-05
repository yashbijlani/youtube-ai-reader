import type { VideoInfo } from "../types";
import { SparkleIcon } from "./Icons";

interface EmptyViewProps {
  video: VideoInfo;
  onGenerate: () => void;
  busy: boolean;
  message?: string | null;
}

export function EmptyView({ video, onGenerate, busy, message }: EmptyViewProps) {
  return (
    <div className="center-state">
      <span className="state-icon">
        <SparkleIcon size={20} />
      </span>
      <h3>Read this video with AI</h3>
      <p>
        {video.title
          ? `Generate a readable overview, chapters, searchable transcript and a grounded chat for “${video.title}”.`
          : "Generate a readable overview, chapters, searchable transcript and a grounded chat."}
      </p>
      {message ? <p className="muted small">{message}</p> : null}
      <button type="button" className="button primary" onClick={onGenerate} disabled={busy}>
        {busy ? <span className="spinner-inline" /> : <SparkleIcon size={14} />}
        {busy ? "Starting…" : "Read with AI"}
      </button>
      <p className="muted small">Uses the configured backend · results are cached per video</p>
    </div>
  );
}
