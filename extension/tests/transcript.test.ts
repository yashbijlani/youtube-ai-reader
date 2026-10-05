import { describe, expect, it } from "vitest";
import { hasBrowserTranscript } from "../src/lib/transcript";
import type { TranscriptExtractionResult } from "../src/types";

const base = { videoId: "dQw4w9WgXcQ", language: "en", kind: "manual" as const };

describe("hasBrowserTranscript", () => {
  it("accepts a json3 capture", () => {
    const result: TranscriptExtractionResult = {
      status: "ok",
      payload: { ...base, format: "json3", content: '{"events":[]}' },
    };
    expect(hasBrowserTranscript(result)).toBe(true);
  });

  it("accepts a segments capture", () => {
    const result: TranscriptExtractionResult = {
      status: "ok",
      payload: { ...base, format: "segments", segments: [{ start: 0, end: 1, text: "hi" }] },
    };
    expect(hasBrowserTranscript(result)).toBe(true);
  });

  it("rejects an empty capture, no-captions, errors, and null", () => {
    expect(
      hasBrowserTranscript({ status: "ok", payload: { ...base, format: "json3", content: "" } }),
    ).toBe(false);
    expect(hasBrowserTranscript({ status: "ok", payload: { ...base, format: "segments", segments: [] } })).toBe(false);
    expect(hasBrowserTranscript({ status: "no_captions" })).toBe(false);
    expect(hasBrowserTranscript({ status: "error", message: "boom" })).toBe(false);
    expect(hasBrowserTranscript(null)).toBe(false);
    expect(hasBrowserTranscript(undefined)).toBe(false);
  });
});
