import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  dedupeRolling,
  normalizeSegments,
  parseJson3,
  summarize,
  toText,
} from "../../src/transcript-rnd/parseJson3";

const manual = readFileSync(fileURLToPath(new URL("./fixtures/json3-manual.json", import.meta.url)), "utf8");
const auto = readFileSync(fileURLToPath(new URL("./fixtures/json3-auto.json", import.meta.url)), "utf8");

describe("parseJson3", () => {
  it("parses manual caption events with timestamps and strips inline tags", () => {
    const segments = parseJson3(manual);
    expect(segments).toHaveLength(5);
    expect(segments[0]).toMatchObject({ start: 0.08, end: 2.08, text: "This is a 3." });
    expect(segments[4].text).toBe("It's a neural network.");
  });

  it("groups word-level auto captions into phrases", () => {
    const segments = parseJson3(auto);
    // 20 word events must collapse into far fewer phrase segments.
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.length).toBeLessThan(10);
    expect(segments[0].text).toContain("hello world");
    expect(segments.every((s) => s.end >= s.start)).toBe(true);
  });

  it("returns [] for malformed input", () => {
    expect(parseJson3("not json")).toEqual([]);
    expect(parseJson3("{\"events\":[]}")).toEqual([]);
  });
});

describe("normalizeSegments", () => {
  it("sorts, cleans, and enforces monotonic durations", () => {
    const out = normalizeSegments([
      { start: 5, end: 5, text: "  second  " },
      { start: 1, end: 2, text: "first" },
      { start: 3, end: 3, text: "" },
    ]);
    expect(out.map((s) => s.text)).toEqual(["first", "second"]);
    expect(out[1].end).toBeGreaterThan(out[1].start);
  });

  it("removes rolling-caption duplication", () => {
    const deduped = dedupeRolling([
      { start: 0, end: 1, text: "hello" },
      { start: 1, end: 2, text: "hello world" },
      { start: 2, end: 3, text: "hello world" },
    ]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe("hello world");
    expect(deduped[0].end).toBe(3);
  });
});

describe("summarize / toText", () => {
  it("computes counts and timestamp range", () => {
    const summary = summarize(parseJson3(manual));
    expect(summary.segmentCount).toBe(5);
    expect(summary.characterCount).toBeGreaterThan(50);
    expect(summary.wordCount).toBeGreaterThan(10);
    expect(summary.firstTimestamp).toBeCloseTo(0.08);
    expect(summary.lastTimestamp).toBeCloseTo(8.08);
    expect(summary.timestamped).toBe(true);
  });

  it("renders backend-compatible text with [mm:ss] stamps", () => {
    const text = toText([{ start: 62.5, end: 63, text: "hi" }]);
    expect(text).toBe("[01:02] hi");
  });
});
