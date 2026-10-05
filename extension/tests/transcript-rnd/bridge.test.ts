// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { isCaptionMessage, waitForCaptionMessage } from "../../src/transcript-rnd/bridge";
import type { PageCaptionMessage } from "../../src/transcript-rnd/types";

const valid: PageCaptionMessage = {
  source: "yair-rnd",
  token: "tok-1",
  type: "caption",
  via: "xhr",
  paramKeys: ["v", "pot"],
  hasPot: true,
  bytes: 100,
  text: "{\"events\":[]}",
};

describe("isCaptionMessage", () => {
  it("accepts a well-formed message with the right token/source/type", () => {
    expect(isCaptionMessage(valid, "tok-1")).toBe(true);
  });

  it("rejects wrong token, source, type, missing text, or empty bytes", () => {
    expect(isCaptionMessage(valid, "other")).toBe(false);
    expect(isCaptionMessage({ ...valid, source: "evil" }, "tok-1")).toBe(false);
    expect(isCaptionMessage({ ...valid, type: "exec" }, "tok-1")).toBe(false);
    expect(isCaptionMessage({ ...valid, text: 42 }, "tok-1")).toBe(false);
    expect(isCaptionMessage({ ...valid, bytes: 0 }, "tok-1")).toBe(false);
    expect(isCaptionMessage({ ...valid, paramKeys: "v" }, "tok-1")).toBe(false);
    expect(isCaptionMessage(null, "tok-1")).toBe(false);
    expect(isCaptionMessage("string", "tok-1")).toBe(false);
  });
});

describe("waitForCaptionMessage", () => {
  it("resolves with the largest payload and ignores invalid messages", async () => {
    const promise = waitForCaptionMessage({ token: "tok-1", timeoutMs: 200 });
    const fire = (data: unknown) =>
      window.dispatchEvent(new MessageEvent("message", { data, source: window }));
    fire({ ...valid, bytes: 50, text: "small" });
    fire({ source: "evil", token: "tok-1", type: "caption", text: "nope", bytes: 999, paramKeys: [] });
    fire({ ...valid, bytes: 500, text: "big" });
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.bytes).toBe(500);
    expect(result?.text).toBe("big");
  });

  it("resolves null on timeout when nothing valid arrives", async () => {
    vi.useFakeTimers();
    const promise = waitForCaptionMessage({ token: "tok-1", timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(promise).resolves.toBeNull();
    vi.useRealTimers();
  });
});
