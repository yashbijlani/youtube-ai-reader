# Browser-side transcript architecture

Status: **verified experimentally** (see `transcript-rnd-results.md`). This
document describes how the extension obtains a timestamped transcript without
the server scraping YouTube.

## Problem

YouTube's caption endpoint `/api/timedtext` now answers **HTTP 200 with an empty
body** unless the request carries a proof-of-origin (`pot`) token that is
generated inside the page by YouTube's player (BotGuard). Our extension cannot
mint that token, and re-fetching the caption URL from page context therefore
returns nothing.

The key insight: **we do not need to fetch captions ourselves.** YouTube's own
player already fetches them successfully. We only need to observe that response.

## Verified mechanism: MAIN-world interception (Method C)

```
YouTube page (MAIN world)
  yt.player ──XHR──▶ /api/timedtext?...&pot=...   (signed, succeeds)
        │                      │
        │                      ▼
        │            page-interceptor.ts (patched XMLHttpRequest / fetch)
        │                      │  window.postMessage({ source, token, type,
        │                      │    via, paramKeys, hasPot, bytes, text })
        ▼                      ▼
content script / background ◀── validated bridge (bridge.ts)
        │
        ▼
backend POST /api/videos/{id}/ingest  (format=json3)  [existing endpoint]
        │
        ▼
normalize → chunk → BM25 → AI   (unchanged; AI never learns the source)
```

Why it works:

- The player's request is same-origin and already authenticated with the session
  and `pot`; the response body is full json3 with `tStartMs`/`dDurationMs` per
  event — perfect for timestamp citations.
- MV3 cannot read response bodies with `webRequest`, but patching `fetch` and
  `XMLHttpRequest` **inside the page's MAIN world** gives access to the response
  the player received.
- The player uses `XMLHttpRequest` for `/api/timedtext` today (observed); the
  interceptor patches both XHR and `fetch` defensively.

### Trigger sequence (load-bearing)

The caption request only fires when captions are requested. The reliable
sequence, discovered experimentally, is:

1. Inject the interceptor into the MAIN world **before page scripts run**
   (`chrome.scripting.executeScript({ world: "MAIN" })` or
   `document_start` content script).
2. `player.setOption("captions", "track", { languageCode })`.
3. Toggle the CC control (`.ytp-subtitles-button`) — this forces a *fresh*
   signed caption request after the interceptor is installed.
4. `player.playVideo()`.
5. Wait for a non-empty captured body (retry the toggle; some ASR-only tracks
   need a second request).

## Fallback chain

```
1. main_world_intercept   browser, full timestamps   (primary)
2. caption_dom            browser, lossy timestamps  (secondary)
3. server yt-dlp / youtube-transcript-api            (existing fallback)
4. unsupported            ("Couldn't obtain a transcript")
```

- **caption_dom** reads `.ytp-caption-segment` while the video plays and stamps
  samples with `video.currentTime`. It is real-time only (no fast-forward), may
  duplicate or miss lines, and is a last resort for videos where the signed
  response is not observable.
- Server `yt-dlp` remains for videos with no captions/ASR, for regions/accounts
  where interception fails, and as the ultimate safety net. Keep it paced
  (`YTDLP_CONCURRENCY=1`) and cookie-configured.

Local ASR is **not** part of the production chain; see the results report for
the feasibility assessment (Method G/H).

## Interfaces (preserve the existing abstractions)

- Extension R&D modules live in `extension/src/transcript-rnd/`:
  - `page-interceptor.ts` — MAIN-world XHR/fetch observer (self-contained).
  - `bridge.ts` — validated `postMessage` bridge (`isCaptionMessage`).
  - `methods.ts` — MAIN-world helpers (inspect tracks, trigger captions, DOM capture).
  - `parseJson3.ts` — pure json3 parser + normalisation (mirrors the backend).
  - `browser-provider.ts` — `BrowserTranscriptProvider` orchestrator +
    `toIngestPayload()`.
  - `debug.html` / `debug.ts` — debug UI (`npm run build:rnd`).
- Backend: reuse `POST /api/videos/{id}/ingest` (already accepts
  `{ format: "json3", content }`) and `TranscriptProvider` /
  `YtDlpTranscriptProvider` as the server fallback. The AI layer is untouched.

## Security constraints

- The interceptor only inspects URLs matching `/api/timedtext` and forwards the
  response text plus non-sensitive metadata (`paramKeys`, `hasPot`). It never
  reads cookies, `Authorization` headers, request bodies, or other traffic.
- The bridge rejects messages whose `event.source !== window`, or whose
  `source`/`token`/`type`/shape do not match. Message content is never executed.
- Only `video_id`, metadata and the transcript are sent to our backend.
  Provider keys stay server-side.

## Production integration sketch

```ts
const provider = new BrowserTranscriptProvider();
const result = await provider.extract(tabId, { prefLang: "en" });
if (result) {
  await api.ingest(videoId, toIngestPayload(result, meta));
} else {
  await api.processVideo(videoUrl); // server yt-dlp fallback
}
```

`background.ts` already performs client-side extraction and posts to `/ingest`;
the winning implementation replaces its direct `timedtext` fetch (which returns
empty) with the MAIN-world interception + trigger sequence above.

## Known risks

- YouTube may change the caption transport (XHR → fetch/stream), the trigger
  (CC toggle/`setOption`), or the json3 shape. Parsers are isolated and tested.
- Automated/headless environments can be flagged and served empty captions;
  real user browsers with a normal session are the target. See the report.
- Some auto-caption tracks group word-level events; the parser groups them into
  phrases identically to the backend for comparable output.
