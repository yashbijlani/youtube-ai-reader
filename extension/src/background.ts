import { BrowserTranscriptProvider, toClientPayload } from "./transcript-rnd/browser-provider";
import type {
  BackgroundBroadcast,
  ClientTranscriptPayload,
  ContentToBackground,
  PanelToBackground,
  TranscriptExtractionResult,
  VideoContextSnapshot,
  VideoInfo,
} from "./types";

const STORAGE_KEY = "yair.context";
const TRANSCRIPTS_KEY = "yair.clientTranscripts";

interface RuntimeState {
  video: VideoInfo | null;
  playbackSeconds: number | null;
  requestedVideoId: string | null;
  tabId: number | null;
  updatedAt: number;
}

const state: RuntimeState = {
  video: null,
  playbackSeconds: null,
  requestedVideoId: null,
  tabId: null,
  updatedAt: Date.now(),
};

function snapshot(): VideoContextSnapshot {
  return {
    video: state.video,
    playbackSeconds: state.playbackSeconds,
    updatedAt: state.updatedAt,
  };
}

async function persist(): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORAGE_KEY]: { ...state } });
  } catch {
    // session storage is best-effort
  }
}

async function restore(): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as RuntimeState | undefined;
    if (value && typeof value === "object") {
      Object.assign(state, value);
    }
  } catch {
    // ignore
  }
}

function broadcast(requestedVideoId: string | null = state.requestedVideoId): void {
  const message: BackgroundBroadcast = {
    type: "CONTEXT_UPDATED",
    context: snapshot(),
    requestedVideoId,
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // No side panel open; nothing to notify.
  });
}

let lastPlaybackBroadcast = 0;
function broadcastPlaybackThrottled(): void {
  const now = Date.now();
  if (now - lastPlaybackBroadcast < 900) return;
  lastPlaybackBroadcast = now;
  broadcast();
}

/**
 * Production browser transcript acquisition (R&D-verified).
 *
 * Fallback chain:
 *   1. MAIN-world interception of YouTube's own signed `/api/timedtext`
 *      response (primary; full timestamps).
 *   2. Rendered caption DOM capture (lossy, real-time).
 * Server yt-dlp remains the caller's fallback when this returns null.
 *
 * The interceptor is narrowly scoped to caption requests (see
 * `transcript-rnd/page-interceptor.ts`); it never reads cookies, auth headers,
 * request bodies, or unrelated traffic.
 */
const browserProvider = new BrowserTranscriptProvider();

async function storeClientTranscript(
  videoId: string,
  payload: ClientTranscriptPayload,
): Promise<void> {
  payload.videoId = videoId;
  try {
    const stored = await chrome.storage.session.get(TRANSCRIPTS_KEY);
    const all = (stored[TRANSCRIPTS_KEY] as Record<string, ClientTranscriptPayload>) ?? {};
    all[videoId] = payload;
    await chrome.storage.session.set({ [TRANSCRIPTS_KEY]: all });
    console.log(
      `[yair] client transcript ready id=${videoId} source=${payload.method ?? "unknown"} (${payload.content?.length ?? payload.segments?.length ?? 0} ${payload.format})`,
    );
  } catch (error) {
    console.warn("[yair] storing client transcript failed", error);
  }
}

async function getClientTranscript(videoId: string): Promise<ClientTranscriptPayload | null> {
  try {
    const stored = await chrome.storage.session.get(TRANSCRIPTS_KEY);
    const all = (stored[TRANSCRIPTS_KEY] as Record<string, ClientTranscriptPayload>) ?? {};
    return all[videoId] ?? null;
  } catch {
    return null;
  }
}

// In-flight extractions per tab, so a pre-extraction on navigation and an
// awaited request from the panel share one capture instead of racing.
const extractionInflight: Record<number, Promise<TranscriptExtractionResult>> = {};

function extractAndStore(tabId: number, videoId: string): Promise<TranscriptExtractionResult> {
  const existing = extractionInflight[tabId];
  if (existing) return existing;
  const task = (async (): Promise<TranscriptExtractionResult> => {
    try {
      const result = await browserProvider.extract(tabId, {
        prefLang: "en",
        interceptTimeoutMs: 20000,
        domFallbackMs: 8000,
      });
      if (!result) {
        console.log("[yair] no browser captions found; server fallback will handle it");
        return { status: "no_captions" };
      }
      const payload = toClientPayload(result);
      await storeClientTranscript(videoId, payload);
      return { status: "ok", payload };
    } catch (error) {
      console.warn("[yair] browser transcript extraction failed", error);
      return { status: "error", message: (error as Error).message };
    }
  })().finally(() => {
    delete extractionInflight[tabId];
  });
  extractionInflight[tabId] = task;
  return task;
}

const extractionTimers: Record<number, number> = {};

function scheduleExtraction(tabId: number | undefined, videoId: string, delay = 1500): void {
  if (tabId == null) return;
  const existing = extractionTimers[tabId];
  if (existing) clearTimeout(existing);
  extractionTimers[tabId] = setTimeout(() => {
    delete extractionTimers[tabId];
    void extractAndStore(tabId, videoId);
  }, delay) as unknown as number;
}

async function openPanel(tabId?: number): Promise<boolean> {
  try {
    if (tabId != null) {
      await chrome.sidePanel.open({ tabId });
    } else {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id != null) await chrome.sidePanel.open({ tabId: tab.id });
    }
    return true;
  } catch (error) {
    console.warn("[yair] sidePanel.open failed", error);
    return false;
  }
}

async function seekTo(seconds: number, videoId?: string): Promise<boolean> {
  const candidates: number[] = [];
  if (state.tabId != null && (!videoId || state.video?.videoId === videoId)) {
    candidates.push(state.tabId);
  }
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://www.youtube.com/*", "https://m.youtube.com/*"],
    });
    for (const tab of tabs) {
      if (tab.id != null && !candidates.includes(tab.id)) candidates.push(tab.id);
    }
  } catch {
    // tabs permission is covered by host permissions; ignore failures
  }
  for (const tabId of candidates) {
    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: "SEEK_TO",
        seconds,
      })) as { ok?: boolean } | undefined;
      if (response?.ok) return true;
    } catch {
      // content script not present in this tab; try the next candidate
    }
  }
  return false;
}

async function handle(
  message: ContentToBackground | PanelToBackground | { type: "PING" },
  sender: chrome.runtime.MessageSender,
  ): Promise<unknown> {
  switch (message.type) {
    case "VIDEO_CHANGED": {
      state.video = message.video;
      state.tabId = sender.tab?.id ?? state.tabId;
      state.requestedVideoId = null;
      if (!message.video) state.playbackSeconds = null;
      state.updatedAt = Date.now();
      await persist();
      broadcast(null);
      if (message.video) {
        scheduleExtraction(sender.tab?.id ?? state.tabId ?? undefined, message.video.videoId);
      }
      return { ok: true };
    }
    case "PLAYBACK_TIME": {
      if (message.videoId === state.video?.videoId) {
        state.playbackSeconds = message.seconds;
        state.updatedAt = Date.now();
        broadcastPlaybackThrottled();
      }
      return { ok: true };
    }
    case "READ_WITH_AI_REQUESTED": {
      state.video = message.video;
      state.tabId = sender.tab?.id ?? state.tabId;
      state.requestedVideoId = message.video.videoId;
      state.updatedAt = Date.now();
      scheduleExtraction(sender.tab?.id ?? state.tabId ?? undefined, message.video.videoId, 0);
      const opened = await openPanel(sender.tab?.id);
      await persist();
      broadcast();
      return { ok: true, opened };
    }
    case "GET_CONTEXT":
      return { ...snapshot(), requestedVideoId: state.requestedVideoId };
    case "GET_CLIENT_TRANSCRIPT":
      return getClientTranscript(message.videoId);
    case "EXTRACT_CLIENT_TRANSCRIPT": {
      const tabId = sender.tab?.id ?? state.tabId ?? undefined;
      const cached = await getClientTranscript(message.videoId);
      if (cached) return { status: "ok", payload: cached } satisfies TranscriptExtractionResult;
      if (tabId == null) return { status: "error", message: "No active YouTube tab." } satisfies TranscriptExtractionResult;
      return extractAndStore(tabId, message.videoId);
    }
    case "CONSUME_REQUEST":
      state.requestedVideoId = null;
      return { ok: true };
    case "SEEK_TO":
      return { ok: await seekTo(message.seconds, message.videoId) };
    case "OPEN_PANEL":
      return { ok: await openPanel(sender.tab?.id) };
    case "PING":
      return { ok: true };
    default:
      return { ok: false };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message as ContentToBackground | PanelToBackground, sender)
    .then(sendResponse)
    .catch((error) => {
      console.warn("[yair] message handling failed", error);
      sendResponse({ ok: false });
    });
  return true; // keep the channel open for async responses
});

function configurePanelBehavior(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn("[yair] setPanelBehavior failed", error));
}

chrome.runtime.onInstalled.addListener(configurePanelBehavior);
chrome.runtime.onStartup.addListener(configurePanelBehavior);
configurePanelBehavior();
void restore();
