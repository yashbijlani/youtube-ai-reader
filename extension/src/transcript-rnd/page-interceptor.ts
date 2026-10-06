/**
 * R&D: page-context caption interceptor (runs in the page's MAIN world).
 *
 * Production hypothesis: YouTube's player issues its own `/api/timedtext`
 * request carrying a proof-of-origin (`pot`) token that we cannot reproduce
 * from the extension. Instead of fetching captions ourselves, we observe the
 * response the player already received.
 *
 * Must be fully self-contained: this function is serialized and injected via
 * `chrome.scripting.executeScript({ world: "MAIN", func })` or
 * `page.evaluateOnNewDocument(fn)`.
 *
 * Security: only ever forwards timedtext *response text* plus non-sensitive
 * metadata (param names / hasPot). Never reads cookies, authorization headers,
 * request bodies, or unrelated network traffic.
 */

export interface PageInterceptorConfig {
  /** Nonce echoed on every message so the bridge can reject foreign posts. */
  token: string;
  /** Message channel marker. */
  source?: string;
  /** Also patch fetch (XHR is the observed path today, but keep both). */
  patchFetch?: boolean;
}

export function pageInterceptor(config: PageInterceptorConfig): void {
  const SOURCE = config.source || "yair-rnd";
  const TOKEN = config.token;
  const state = { installed: false, captures: 0 };

  try {
    const w = window as unknown as Record<string, unknown>;
    if (w.__yairInterceptorInstalled) return;
    w.__yairInterceptorInstalled = true;

    const isCaptionUrl = (u: unknown): u is string =>
      typeof u === "string" && /\/api\/timedtext/i.test(u);

    const paramKeys = (u: string): string[] => {
      try {
        return Array.from(new URL(u, location.href).searchParams.keys());
      } catch {
        return [];
      }
    };

    const emit = (via: string, url: string, text: string): void => {
      if (!text || text.length === 0) return;
      state.captures += 1;
      const payload = {
        source: SOURCE,
        token: TOKEN,
        type: "caption",
        via,
        paramKeys: paramKeys(url),
        hasPot: /[?&]pot=/.test(url),
        bytes: text.length,
        text,
      };
      // Path 1: validated postMessage bridge (content script).
      try {
        window.postMessage(payload, location.origin || "*");
      } catch {
        /* ignore */
      }
      // Path 2: page-visible buffer read by chrome.scripting from the background.
      try {
        const w = window as unknown as { __yairCaptured?: typeof payload[] };
        if (!Array.isArray(w.__yairCaptured)) w.__yairCaptured = [];
        w.__yairCaptured.push(payload);
      } catch {
        /* ignore */
      }
    };

    // --- XMLHttpRequest (observed path for YouTube timedtext today) ---
    const OrigXHR = window.XMLHttpRequest;
    function PatchedXHR(this: XMLHttpRequest) {
      const xhr = new OrigXHR();
      let url = "";
      const originalOpen = xhr.open;
      xhr.open = function (
        this: XMLHttpRequest,
        method: string,
        u: string | URL,
        ...rest: unknown[]
      ): void {
        url = String(u);
        // @ts-expect-error - variadic passthrough
        return originalOpen.call(this, method, u, ...rest);
      } as typeof xhr.open;
      xhr.addEventListener("load", () => {
        if (!isCaptionUrl(url)) return;
        try {
          emit("xhr", url, xhr.responseText || "");
        } catch {
          /* ignore */
        }
      });
      return xhr;
    }
    (PatchedXHR as unknown as { prototype: unknown }).prototype = OrigXHR.prototype;
    // Preserve static constants (DONE, OPENED, ..., and any others) so page code
    // that reads XMLHttpRequest.DONE keeps working.
    for (const key of Object.getOwnPropertyNames(OrigXHR)) {
      if (key === "prototype" || key === "length" || key === "name") continue;
      try {
        (PatchedXHR as unknown as Record<string, unknown>)[key] = (
          OrigXHR as unknown as Record<string, unknown>
        )[key];
      } catch {
        /* ignore read-only */
      }
    }
    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;

    // --- fetch (defensive: some clients use fetch) ---
    if (config.patchFetch !== false) {
      const origFetch = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const promise = origFetch.call(this, input as RequestInfo, init);
        if (isCaptionUrl(url)) {
          promise
            .then((res) => {
              res
                .clone()
                .text()
                .then((text) => emit("fetch", url, text))
                .catch(() => {});
            })
            .catch(() => {});
        }
        return promise;
      };
    }

    state.installed = true;
  } catch {
    /* never throw into the page */
  }
}
