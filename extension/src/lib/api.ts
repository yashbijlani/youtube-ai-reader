import type {
  Chapter,
  ChatResponse,
  Citation,
  HealthInfo,
  KeyPoint,
  Transcript,
  UsageInfo,
  VideoState,
} from "../types";
import { getAccessToken } from "./auth";
import { getInstallId } from "./install";

export class ApiError extends Error {
  code: string;
  status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE =
  "Can't reach the reader backend. Make sure it's running, then try again.";

function baseUrlOf(baseUrl: string): string {
  return (baseUrl || "").replace(/\/+$/, "");
}

/** Centralized auth header: every authenticated request goes through here. */
async function authHeader(): Promise<Record<string, string>> {
  const token = await getAccessToken().catch(() => null);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  const installId = await getInstallId();
  try {
    response = await fetch(`${baseUrlOf(baseUrl)}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Install-Id": installId,
        ...(await authHeader()),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("network_error", NETWORK_MESSAGE);
  }
  if (!response.ok) {
    throw await toApiError(response);
  }
  return (await response.json()) as T;
}

async function toApiError(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    const error = body?.error;
    if (error?.message) {
      return new ApiError(error.code ?? "api_error", error.message, response.status);
    }
  } catch {
    // fall through
  }
  if (response.status === 404) {
    return new ApiError("not_found", "This resource was not found.", 404);
  }
  return new ApiError("api_error", `The backend returned an error (HTTP ${response.status}).`, response.status);
}

export const api = {
  health(baseUrl: string): Promise<HealthInfo> {
    return request<HealthInfo>(baseUrl, "/api/health");
  },

  processVideo(baseUrl: string, youtubeUrl: string, force = false): Promise<VideoState> {
    return request<VideoState>(baseUrl, "/api/videos/process", {
      method: "POST",
      body: JSON.stringify({ youtube_url: youtubeUrl, force }),
    });
  },

  getVideoState(baseUrl: string, videoId: string): Promise<VideoState> {
    return request<VideoState>(baseUrl, `/api/videos/${videoId}`);
  },

  getTranscript(baseUrl: string, videoId: string): Promise<Transcript> {
    return request<Transcript>(baseUrl, `/api/videos/${videoId}/transcript`);
  },

  reprocess(baseUrl: string, videoId: string): Promise<VideoState> {
    return request<VideoState>(baseUrl, `/api/videos/${videoId}/reprocess`, {
      method: "POST",
      body: "{}",
    });
  },

  cancel(baseUrl: string, videoId: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(baseUrl, `/api/videos/${videoId}/cancel`, {
      method: "POST",
      body: "{}",
    });
  },

  repair(baseUrl: string, videoId: string): Promise<VideoState> {
    return request<VideoState>(baseUrl, `/api/videos/${videoId}/repair`, {
      method: "POST",
      body: "{}",
    });
  },

  ingest(
    baseUrl: string,
    videoId: string,
    payload: {
      title?: string;
      channel?: string;
      duration?: number;
      language?: string;
      kind: "manual" | "auto";
      format: "json3" | "segments";
      content?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    },
  ): Promise<VideoState> {
    return request<VideoState>(baseUrl, `/api/videos/${videoId}/ingest`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  usage(baseUrl: string): Promise<UsageInfo> {
    return request<UsageInfo>(baseUrl, "/api/usage");
  },

  setEntitlement(baseUrl: string, paid: boolean, email?: string | null): Promise<UsageInfo> {
    return request<UsageInfo>(baseUrl, "/api/entitlement", {
      method: "POST",
      body: JSON.stringify({ paid, email: email ?? null }),
    });
  },

  ask(
    baseUrl: string,
    videoId: string,
    payload: {
      message: string;
      history: Array<{ role: "user" | "assistant"; content: string }>;
      current_time_seconds?: number | null;
    },
  ): Promise<ChatResponse> {
    return request<ChatResponse>(baseUrl, `/api/videos/${videoId}/chat`, {
      method: "POST",
      body: JSON.stringify({ ...payload, stream: false }),
    });
  },
};

export interface StreamHandlers {
  onDelta(text: string): void;
  onDone(citations: Citation[], usage?: { model?: string | null }): void;
  onError(error: ApiError): void;
}

/**
 * Stream an answer over SSE. Falls back to a plain JSON answer when the
 * backend cannot stream, so the UI always gets an answer.
 */
export async function askStream(
  baseUrl: string,
  videoId: string,
  payload: {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    current_time_seconds?: number | null;
  },
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrlOf(baseUrl)}/api/videos/${videoId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Install-Id": await getInstallId(),
        ...(await authHeader()),
      },
      body: JSON.stringify({ ...payload, stream: true }),
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    handlers.onError(new ApiError("network_error", NETWORK_MESSAGE));
    return;
  }

  if (!response.ok) {
    handlers.onError(await toApiError(response));
    return;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    // Backend answered with plain JSON (streaming fallback).
    try {
      const data = (await response.json()) as ChatResponse;
      if (data.answer) handlers.onDelta(data.answer);
      handlers.onDone(data.citations ?? [], data.usage);
      return;
    } catch {
      handlers.onError(new ApiError("api_error", "Unexpected response from the backend."));
      return;
    }
  }

  await consumeSse(response, handlers);
}

/**
 * Stream a grounded summary from the backend's fast summarize endpoint.
 * Available as soon as the transcript is ready, before the guide exists.
 */
export async function summarizeStream(
  baseUrl: string,
  videoId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrlOf(baseUrl)}/api/videos/${videoId}/summarize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Install-Id": await getInstallId(),
        ...(await authHeader()),
      },
      body: "{}",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    handlers.onError(new ApiError("network_error", NETWORK_MESSAGE));
    return;
  }
  if (!response.ok) {
    handlers.onError(await toApiError(response));
    return;
  }
  await consumeSse(response, handlers);
}

export interface AnalysisStreamHandlers {
  onOverview(overview: string, keyPoints: KeyPoint[]): void;
  onChapters(chapters: Chapter[]): void;
  onReading(text: string): void;
  onReadingSection(index: number, text: string): void;
  onReadingDelta(index: number, text: string): void;
  onQuickRead(text: string): void;
  onQuickReadDelta(text: string): void;
  onDone(analysisStatus: string): void;
  onError(error: ApiError): void;
}

/** Stream the reading guide: parts as events, detailed reading token-by-token. */
export async function analysisStream(
  baseUrl: string,
  videoId: string,
  handlers: AnalysisStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${baseUrlOf(baseUrl)}/api/videos/${videoId}/analysis/stream`, {
      signal,
      headers: {
        Accept: "text/event-stream",
        "X-Install-Id": await getInstallId(),
        ...(await authHeader()),
      },
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    handlers.onError(new ApiError("network_error", NETWORK_MESSAGE));
    return;
  }
  if (!response.ok) {
    handlers.onError(await toApiError(response));
    return;
  }
  if (!response.body) {
    handlers.onError(new ApiError("stream_error", "The backend did not return a stream."));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        switch (event.type) {
          case "part":
            if (event.part === "overview") {
              handlers.onOverview(
                (event.overview as string) ?? "",
                (event.key_points as KeyPoint[]) ?? [],
              );
            } else if (event.part === "chapters") {
              handlers.onChapters((event.chapters as Chapter[]) ?? []);
            }
            break;
          case "reading":
            handlers.onReading((event.text as string) ?? "");
            break;
          case "reading_section":
            handlers.onReadingSection(Number(event.index), (event.text as string) ?? "");
            break;
          case "reading_delta":
            handlers.onReadingDelta(Number(event.index), (event.text as string) ?? "");
            break;
          case "quick_read":
            handlers.onQuickRead((event.text as string) ?? "");
            break;
          case "quick_read_delta":
            handlers.onQuickReadDelta((event.text as string) ?? "");
            break;
          case "done":
            handlers.onDone((event.analysis_status as string) ?? "ready");
            return;
          case "error":
            handlers.onError(
              new ApiError(
                (event.code as string) ?? "stream_error",
                (event.message as string) ?? "The analysis stream failed.",
              ),
            );
            return;
          default:
            break;
        }
      }
    }
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      handlers.onError(new ApiError("stream_error", "The analysis stream was interrupted."));
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function consumeSse(response: Response, handlers: StreamHandlers): Promise<void> {
  if (!response.body) {
    handlers.onError(new ApiError("stream_error", "The backend did not return a stream."));
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawError = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((item) => item.startsWith("data:"));
        if (!line) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (event.type === "delta" && typeof event.text === "string") {
          handlers.onDelta(event.text);
        } else if (event.type === "done") {
          handlers.onDone(
            (event.citations as Citation[]) ?? [],
            event.usage as { model?: string | null } | undefined,
          );
        } else if (event.type === "error") {
          sawError = true;
          handlers.onError(
            new ApiError(
              (event.code as string) ?? "stream_error",
              (event.message as string) ?? "The answer stream failed.",
            ),
          );
        }
      }
    }
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      handlers.onError(new ApiError("stream_error", "The answer stream was interrupted."));
    }
  } finally {
    if (!sawError) reader.releaseLock?.();
  }
}
