import { describe, expect, it } from "vitest";
import { isYouTubeUrl, resolveVideoInfo, videoInfoFromUrl } from "../src/lib/context";
import type { VideoInfo } from "../src/types";

const storedA: VideoInfo = {
  videoId: "dQw4w9WgXcQ",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  title: "Video A",
};
const URL_A = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s";
const URL_B = "https://www.youtube.com/watch?v=9bZkp7q19f0";

describe("isYouTubeUrl", () => {
  it("recognizes YouTube watch URLs and rejects others", () => {
    expect(isYouTubeUrl(URL_A)).toBe(true);
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBe(false);
    expect(isYouTubeUrl("chrome://extensions")).toBe(false);
    expect(isYouTubeUrl(null)).toBe(false);
    expect(isYouTubeUrl("")).toBe(false);
  });
});

describe("videoInfoFromUrl", () => {
  it("extracts the id and builds a canonical url", () => {
    expect(videoInfoFromUrl(URL_B)).toEqual({
      videoId: "9bZkp7q19f0",
      url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    });
    expect(videoInfoFromUrl("https://example.com")).toBeNull();
  });
});

describe("resolveVideoInfo (URL is authoritative)", () => {
  it("trusts stored metadata only when it matches the tab URL", () => {
    expect(resolveVideoInfo(storedA, URL_A)).toEqual({
      videoId: "dQw4w9WgXcQ",
      url: storedA.url,
      title: "Video A",
    });
  });

  it("overrides a stale stored video with the tab's actual video", () => {
    // The previous (cached) video is stored, but the tab is on a different one.
    const resolved = resolveVideoInfo(storedA, URL_B);
    expect(resolved).toEqual({ videoId: "9bZkp7q19f0", url: "https://www.youtube.com/watch?v=9bZkp7q19f0" });
    expect(resolved?.title).toBeUndefined();
  });

  it("returns null off YouTube even with a stored video", () => {
    expect(resolveVideoInfo(storedA, "https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(resolveVideoInfo(storedA, undefined)).toBeNull();
  });

  it("falls back to the URL when nothing is stored", () => {
    expect(resolveVideoInfo(null, URL_B)).toEqual({
      videoId: "9bZkp7q19f0",
      url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
    });
  });
});
