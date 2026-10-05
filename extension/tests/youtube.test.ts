import { describe, expect, it } from "vitest";
import { extractVideoId, isWatchUrl, watchUrlFor } from "../src/lib/youtube";

describe("extractVideoId", () => {
  const valid: Array<[string, string]> = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"],
    ["dQw4w9WgXcQ", "dQw4w9WgXcQ"],
  ];

  it.each(valid)("parses %s", (url, expected) => {
    expect(extractVideoId(url)).toBe(expected);
  });

  const invalid = [
    "",
    null,
    undefined,
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com.evil.io/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=short",
    "javascript:alert(1)",
    "https://www.youtube.com/",
  ];

  it.each(invalid)("rejects %s", (url) => {
    expect(extractVideoId(url as string)).toBeNull();
  });

  it("builds canonical watch urls", () => {
    expect(watchUrlFor("dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(isWatchUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isWatchUrl("https://www.youtube.com/feed/subscriptions")).toBe(false);
  });
});
