/** Format seconds as m:ss or h:mm:ss. */
export function formatTimestamp(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || Number.isNaN(totalSeconds)) return "";
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Parse mm:ss / hh:mm:ss / raw seconds into seconds. */
export function parseTimestamp(text: string): number | null {
  if (!text) return null;
  const trimmed = text.trim().replace(/^\[|\]$/g, "");
  if (/^\d+(\.\d+)?$/.test(trimmed)) return parseFloat(trimmed);
  const match = trimmed.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1] ?? "0", 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  return hours * 3600 + minutes * 60 + seconds;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  return formatTimestamp(seconds);
}

export function timeAgo(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

export function stageLabel(stage: string | null | undefined): string | null {
  switch (stage) {
    case "queued":
      return "Queued…";
    case "fetching_metadata":
      return "Getting video information…";
    case "fetching_transcript":
      return "Finding transcript…";
    case "preparing":
      return "Reading transcript…";
    case "summarizing":
      return "Understanding the video…";
    case "chapters":
      return "Building chapters…";
    case "writing":
      return "Writing the detailed reading…";
    case "ready":
      return "Ready.";
    default:
      return null;
  }
}
