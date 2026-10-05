import type { ApiError } from "../lib/api";
import { AlertIcon, RefreshIcon } from "./Icons";

interface ErrorViewProps {
  error: ApiError | { code: string; message: string };
  onRetry: () => void;
  onReprocess: () => void;
  busy: boolean;
}

function hintFor(code: string): string | null {
  switch (code) {
    case "network_error":
      return "Start the backend with `uvicorn app.main:app --port 8000` in the backend folder, then retry.";
    case "ai_not_configured":
      return "The backend needs OPENCODE_API_KEY set. See backend/.env.example.";
    case "ai_insufficient_funds":
      return "Your AI provider account has no funds, or this model isn't available to API keys. Enable extra usage / add credit, or switch provider in backend/.env.";
    case "ai_access_denied":
      return "The AI provider denied the request. Check the API key and model (some plans only work inside their own client).";
    case "ai_model_unavailable":
      return "That model isn't available to this API key. Pick another model in backend/.env.";
    case "youtube_rate_limited":
      return "YouTube is throttling transcript downloads from this server. Wait a minute and retry, or set YTDLP_COOKIES_FILE on the backend.";
    case "transcript_unavailable":
      return "This video has no captions available, so there is no transcript to read.";
    case "age_restricted":
    case "video_unavailable":
    case "video_not_found":
      return "Try a different public video.";
    case "server_busy":
      return "A few videos are already being processed. Try again in a moment.";
    case "rate_limited":
      return "Wait a little before processing more videos.";
    case "ytdlp_failure":
      return "The video service failed. Update yt-dlp or try again in a moment.";
    default:
      return null;
  }
}

export function ErrorView({ error, onRetry, onReprocess, busy }: ErrorViewProps) {
  const hint = hintFor(error.code);
  const isNetwork = error.code === "network_error";
  return (
    <div className="center-state">
      <span className="state-icon">
        <AlertIcon size={20} />
      </span>
      <h3>Couldn't read this video</h3>
      <p>{error.message}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="button primary" onClick={onRetry} disabled={busy}>
          <RefreshIcon size={13} /> Try again
        </button>
        {!isNetwork ? (
          <button type="button" className="button secondary" onClick={onReprocess} disabled={busy}>
            Reprocess
          </button>
        ) : null}
      </div>
    </div>
  );
}
