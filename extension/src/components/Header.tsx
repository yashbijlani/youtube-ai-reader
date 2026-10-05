import { formatDuration } from "../lib/format";
import type { VideoInfo, VideoMeta, VideoState } from "../types";
import {
  BrandMark,
  RefreshIcon,
  SettingsIcon,
  SparkleIcon,
} from "./Icons";

interface HeaderProps {
  video: VideoInfo;
  state: VideoState | null;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenSettings: () => void;
}

export function Header({ video, state, onRefresh, refreshing, onOpenSettings }: HeaderProps) {
  const meta: VideoMeta | null | undefined = state?.metadata;
  const title = meta?.title ?? video.title ?? "Untitled video";
  const channel = meta?.channel ?? video.channel;
  const duration = meta?.duration ?? video.duration;
  const subtitleKind = meta?.subtitle_kind;

  return (
    <header className="header">
      <div className="header-top">
        <div className="brand">
          <BrandMark size={22} className="brand-mark" />
          <span className="brand-name">YouTube AI Reader</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={`icon-button${refreshing ? " spinning" : ""}`}
            title="Reprocess this video"
            aria-label="Reprocess this video"
            disabled={refreshing || state?.status === "processing"}
            onClick={onRefresh}
          >
            <RefreshIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>
      <div className="video-headline">
        <h1 className="video-title" title={title}>
          {title}
        </h1>
        <div className="video-meta">
          {channel && <span>{channel}</span>}
          {channel && duration ? <span className="dot">•</span> : null}
          {duration ? <span>{formatDuration(duration)}</span> : null}
          {subtitleKind && subtitleKind !== "none" ? (
            <span className={`badge${state?.status === "ready" ? " accent" : ""}`}>
              <SparkleIcon size={10} />
              {subtitleKind === "manual" ? "captions" : "auto captions"}
            </span>
          ) : null}
          {state?.status === "ready" && state.cached ? <span className="badge">cached</span> : null}
          {state?.status === "processing" ? (
            <span className="badge live">
              <span className="spinner-inline" /> working
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
