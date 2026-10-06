import { describe, expect, it } from "vitest";
import {
  BrowserTranscriptProvider,
  toClientPayload,
  toIngestPayload,
  type PageScripting,
} from "../../src/transcript-rnd/browser-provider";

const TRACKS = {
  count: 2,
  manual: 1,
  asr: 1,
  languages: ["en", "en"],
  picked: { languageCode: "en", kind: "manual" },
};

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "Hello there." }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "General Kenobi." }] },
  ],
});

function makeScripting(router: (name: string) => unknown): PageScripting {
  return {
    async injectMainWorld() {},
    async evaluateMainWorld(_tabId: number, func: { name: string }) {
      return router(func.name);
    },
  } as unknown as PageScripting;
}

describe("BrowserTranscriptProvider", () => {
  it("returns parsed segments from the intercepted caption response", async () => {
    const provider = new BrowserTranscriptProvider({
      scripting: makeScripting((name) => {
        if (name === "inspectCaptionTracks" || name === "triggerCaptionRequest") return TRACKS;
        if (name === "readPageCaptures") return { via: "xhr", hasPot: true, bytes: JSON3.length, paramKeys: ["v", "pot"], text: JSON3 };
        return null;
      }),
    });
    const result = await provider.extract(1, { prefLang: "en", interceptTimeoutMs: 5000, stableMs: 20 });
    expect(result).not.toBeNull();
    expect(result?.method).toBe("main_world_intercept");
    expect(result?.segments).toHaveLength(2);
    expect(result?.segments[0].text).toBe("Hello there.");
    expect(result?.sourceInfo.hasPot).toBe(true);

    const payload = toIngestPayload(result!, { title: "T" });
    expect(payload.format).toBe("json3");
    expect(payload.content).toBe(JSON3);
    expect(payload.kind).toBe("manual");
  });

  it("falls back to rendered DOM captions when interception yields nothing", async () => {
    const provider = new BrowserTranscriptProvider({
      scripting: makeScripting((name) => {
        if (name === "inspectCaptionTracks" || name === "triggerCaptionRequest") return TRACKS;
        if (name === "readPageCaptures") return null;
        if (name === "captureDomCaptions") return [{ start: 1.5, text: "dom line" }];
        return null;
      }),
    });
    const result = await provider.extract(1, { interceptTimeoutMs: 60, domFallbackMs: 100 });
    expect(result?.method).toBe("caption_dom");
    expect(result?.segments[0].text).toBe("dom line");
    const payload = toIngestPayload(result!);
    expect(payload.format).toBe("segments");
  });

  it("returns null when neither interception nor DOM yields a transcript", async () => {
    const provider = new BrowserTranscriptProvider({
      scripting: makeScripting(() => null),
    });
    const result = await provider.extract(1, { interceptTimeoutMs: 60, domFallbackMs: 10 });
    expect(result).toBeNull();
  });

  it("falls back to DOM when the intercepted body is malformed", async () => {
    const provider = new BrowserTranscriptProvider({
      scripting: makeScripting((name) => {
        if (name === "inspectCaptionTracks" || name === "triggerCaptionRequest") return TRACKS;
        if (name === "readPageCaptures") return { via: "xhr", hasPot: true, bytes: 16, paramKeys: [], text: "{not json" };
        if (name === "captureDomCaptions") return [{ start: 2, text: "dom fallback" }];
        return null;
      }),
    });
    const result = await provider.extract(1, { interceptTimeoutMs: 200, domFallbackMs: 100, stableMs: 20 });
    expect(result?.method).toBe("caption_dom");
    expect(result?.segments[0].text).toBe("dom fallback");
    expect(toClientPayload(result!).format).toBe("segments");
  });

  it("toClientPayload maps intercepted json3 and exposes the method", () => {
    const payload = toClientPayload(
      {
        method: "main_world_intercept",
        segments: [{ start: 0, end: 1, text: "hi" }],
        json3: JSON3,
        language: "en",
        captionTracks: TRACKS,
        latencyMs: 1,
        sourceInfo: {},
      },
      "abc12345678",
    );
    expect(payload).toMatchObject({ videoId: "abc12345678", format: "json3", kind: "manual" });
    expect(payload.content).toBe(JSON3);
    expect(payload.method).toBe("browser_intercept");
  });
});
