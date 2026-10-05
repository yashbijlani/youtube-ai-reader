import type { ReactNode } from "react";
import { formatDuration } from "../lib/format";
import type { VideoInfo, VideoMeta, VideoState } from "../types";
import { BrandMark, RefreshIcon } from "./Icons";

interface HeaderProps {
  video: VideoInfo;
  state: VideoState | null;
  onRefresh: () => void;
  refreshing: boolean;
  account?: ReactNode;
}

export function Header({ video, state, onRefresh, refreshing, account }: HeaderProps) {
  const meta: VideoMeta | null | undefined = state?.metadata;
  const title = meta?.title ?? video.title ?? "Untitled video";
  const channel = meta?.channel ?? video.channel;
  const duration = meta?.duration ?? video.duration;

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
          {account}
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
