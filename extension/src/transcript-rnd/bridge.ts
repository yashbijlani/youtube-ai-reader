/**
 * R&D: content-script ⇄ MAIN-world bridge for caption interception.
 *
 * The MAIN-world interceptor (`page-interceptor.ts`) cannot talk to the
 * extension APIs directly, so it posts a message and this bridge validates and
 * returns it. Security rules:
 *
 *  - only accept messages where `event.source === window`;
 *  - only accept our `source` marker and a per-request `token` nonce;
 *  - only accept a known `type` (`caption`);
 *  - never `eval`, never execute message content, never forward anything but
 *    the caption text to the caller.
 *
 * The token is a convenience guard against unrelated page messages, not a
 * secret: a hostile page shares the MAIN world and could forge a message, but
 * the worst case is a bogus transcript for the video the user asked to read.
 */

import type { PageCaptionMessage } from "./types";

export interface WaitOptions {
  token: string;
  source?: string;
  /** Resolve with the largest payload seen within this window. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CapturedCaption {
  via: string;
  hasPot: boolean;
  bytes: number;
  paramKeys: string[];
  text: string;
}

/** Validate an untrusted `message` event. Exported for unit testing. */
export function isCaptionMessage(data: unknown, token: string, source = "yair-rnd"): data is PageCaptionMessage {
  if (!data || typeof data !== "object") return false;
  const m = data as Partial<PageCaptionMessage>;
  return (
    m.source === source &&
    m.token === token &&
    m.type === "caption" &&
    typeof m.text === "string" &&
    typeof m.bytes === "number" &&
    m.bytes > 0 &&
    Array.isArray(m.paramKeys)
  );
}

/**
 * Wait for interceptor messages, resolving with the largest caption payload.
 * Call this from a content script after injecting `pageInterceptor`.
 */
export function waitForCaptionMessage(options: WaitOptions): Promise<CapturedCaption | null> {
  const { token, source = "yair-rnd", timeoutMs = 20000, signal } = options;
  return new Promise((resolve) => {
    let best: CapturedCaption | null = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(best);
    };
    const onAbort = () => finish();
    const onMessage = (event: MessageEvent) => {
      // Reject anything not originating from this same window.
      if (event.source !== window) return;
      const data: unknown = event.data;
      if (!isCaptionMessage(data, token, source)) return;
      if (!best || data.bytes > best.bytes) {
        best = {
          via: data.via,
          hasPot: Boolean(data.hasPot),
          bytes: data.bytes,
          paramKeys: data.paramKeys,
          text: data.text,
        };
      }
    };
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort);
    // Small grace period after the first hit so a larger follow-up can win.
    const timer = setTimeout(finish, timeoutMs);
  });
}
