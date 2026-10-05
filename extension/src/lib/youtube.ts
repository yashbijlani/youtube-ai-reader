const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extract a YouTube video id from common URL shapes, or null. */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;
  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = new Set([
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be",
    "www.youtu.be",
  ]);
  if (!allowed.has(host)) return null;
  if (host.endsWith("youtu.be")) {
    const candidate = parsed.pathname.replace(/^\//, "").split("/")[0];
    return VIDEO_ID_RE.test(candidate) ? candidate : null;
  }
  const v = parsed.searchParams.get("v");
  if (v && VIDEO_ID_RE.test(v)) return v;
  const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function isWatchUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

export function watchUrlFor(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
