import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, analysisStream, api, askStream, summarizeStream } from "../src/lib/api";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a process request with the youtube url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ video_id: "abc", status: "processing", cached: false }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.processVideo("http://127.0.0.1:8000/", "https://youtu.be/x");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/videos/process");
    expect(JSON.parse(init.body)).toEqual({ youtube_url: "https://youtu.be/x", force: false });
    expect(init.headers["X-Install-Id"]).toBeTruthy();
    expect(result.video_id).toBe("abc");
  });

  it("maps backend errors to ApiError with friendly message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: { code: "transcript_unavailable", message: "Couldn't obtain a transcript." } },
          422,
        ),
      ),
    );
    await expect(api.getVideoState("http://x", "aaaaaaaaaaa")).rejects.toMatchObject({
      code: "transcript_unavailable",
      status: 422,
      message: "Couldn't obtain a transcript.",
    });
  });

  it("maps network failures to a friendly error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));
    const error = await api.getVideoState("http://x", "aaaaaaaaaaa").catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network_error");
    expect(error.message).toContain("backend");
  });
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("askStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses delta and done events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"delta","text":"Hello "}\n\n',
          'data: {"type":"delta","text":"world [1:00]"}\n\n',
          'data: {"type":"done","citations":[{"start_seconds":60,"quote":"q"}],"usage":{"model":"m"}}\n\n',
        ]),
      ),
    );
    const deltas: string[] = [];
    const doneEvents: Array<{ citations: unknown[] }> = [];
    await askStream(
      "http://x",
      "aaaaaaaaaaa",
      { message: "hi", history: [] },
      {
        onDelta: (text) => deltas.push(text),
        onDone: (citations) => {
          doneEvents.push({ citations });
        },
        onError: () => undefined,
      },
    );
    expect(deltas.join("")).toBe("Hello world [1:00]");
    expect(doneEvents[0]?.citations).toHaveLength(1);
  });

  it("falls back to a JSON answer when the backend does not stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ answer: "plain answer", citations: [{ start_seconds: 5 }] }),
      ),
    );
    const deltas: string[] = [];
    let done = false;
    await askStream(
      "http://x",
      "aaaaaaaaaaa",
      { message: "hi", history: [] },
      {
        onDelta: (text) => deltas.push(text),
        onDone: () => {
          done = true;
        },
        onError: () => undefined,
      },
    );
    expect(deltas.join("")).toBe("plain answer");
    expect(done).toBe(true);
  });

  it("reports stream errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse(['data: {"type":"error","code":"ai_provider_error","message":"boom"}\n\n']),
      ),
    );
    const errors: string[] = [];
    await askStream(
      "http://x",
      "aaaaaaaaaaa",
      { message: "hi", history: [] },
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => errors.push(error.message),
      },
    );
    expect(errors).toEqual(["boom"]);
  });

  it("streams analysis parts and reading tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          'data: {"type":"part","part":"overview","overview":"Big picture","key_points":[{"title":"A","explanation":"B","start_seconds":1}]}\n\n',
          'data: {"type":"reading_section","index":0,"text":"Section zero."}\n\n',
          'data: {"type":"reading_delta","index":1,"text":"Section "}\n\n',
          'data: {"type":"reading_delta","index":1,"text":"one."}\n\n',
          'data: {"type":"done","analysis_status":"ready"}\n\n',
        ]),
      ),
    );
    let overview = "";
    const sections: Record<number, string> = {};
    let doneStatus = "";
    await analysisStream("http://x", "aaaaaaaaaaa", {
      onOverview: (text) => {
        overview = text;
      },
      onChapters: () => undefined,
      onReading: () => undefined,
      onReadingSection: (index, text) => {
        sections[index] = text;
      },
      onReadingDelta: (index, text) => {
        sections[index] = (sections[index] ?? "") + text;
      },
      onQuickRead: () => undefined,
      onQuickReadDelta: () => undefined,
      onDone: (status) => {
        doneStatus = status;
      },
      onError: () => undefined,
    });
    expect(overview).toBe("Big picture");
    expect(sections[0]).toBe("Section zero.");
    expect(sections[1]).toBe("Section one.");
    expect(doneStatus).toBe("ready");
  });

  it("streams a summary from the summarize endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"delta","text":"This video explains "}\n\n',
        'data: {"type":"delta","text":"the topic [1:00]."}\n\n',
        'data: {"type":"done","citations":[{"start_seconds":60}],"usage":{"model":"fast"}}\n\n',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    let model: string | undefined;
    await summarizeStream(
      "http://x",
      "aaaaaaaaaaa",
      {
        onDelta: (text) => deltas.push(text),
        onDone: (_citations, usage) => {
          model = usage?.model ?? undefined;
        },
        onError: () => undefined,
      },
    );
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://x/api/videos/aaaaaaaaaaa/summarize");
    expect(init.method).toBe("POST");
    expect(deltas.join("")).toBe("This video explains the topic [1:00].");
    expect(model).toBe("fast");
  });
});
