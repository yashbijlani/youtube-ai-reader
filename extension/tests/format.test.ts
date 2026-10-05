import { describe, expect, it } from "vitest";
import {
  formatDuration,
  formatTimestamp,
  parseTimestamp,
  stageLabel,
  truncate,
} from "../src/lib/format";

describe("formatTimestamp", () => {
  it("formats short and long durations", () => {
    expect(formatTimestamp(0)).toBe("0:00");
    expect(formatTimestamp(65)).toBe("1:05");
    expect(formatTimestamp(1052)).toBe("17:32");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatTimestamp(null)).toBe("");
    expect(formatTimestamp(-4)).toBe("0:00");
  });
});

describe("parseTimestamp", () => {
  it("parses timestamps", () => {
    expect(parseTimestamp("17:32")).toBe(1052);
    expect(parseTimestamp("1:02:05")).toBe(3725);
    expect(parseTimestamp("90")).toBe(90);
    expect(parseTimestamp("nope")).toBeNull();
  });
});

describe("helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(0)).toBe("");
  });

  it("maps backend stages to messages", () => {
    expect(stageLabel("fetching_transcript")).toBe("Finding transcript…");
    expect(stageLabel("ready")).toBe("Ready.");
    expect(stageLabel("unknown")).toBeNull();
  });

  it("truncates text", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hi", 8)).toBe("hi");
  });
});
