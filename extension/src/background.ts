import { extpay } from "./lib/entitlement";
import { pageInterceptor } from "./transcript-rnd/page-interceptor";
import { triggerCaptionRequest } from "./transcript-rnd/methods";
import type {
  BackgroundBroadcast,
  ClientTranscriptPayload,
  ContentToBackground,
  PanelToBackground,
  VideoContextSnapshot,
  VideoInfo,
} from "./types";

const STORAGE_KEY = "yair.context";
const TRANSCRIPTS_KEY = "yair.clientTranscripts";

// ExtensionPay requires its background listener to be registered once.
extpay.startBackground();

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
 * R&D-verified caption acquisition (Method C).
 *
 * YouTube's own player fetches `/api/timedtext` with a proof-of-origin (`pot`)
 * token we cannot mint, so fetching the caption URL ourselves returns an empty
 * body. Instead we observe the response the player already received by patching
 * `XMLHttpRequest`/`fetch` in the page's MAIN world.
 *
 * 1. install the interceptor (captures any caption response body);
 * 2. turn captions on + play so the player issues a signed caption request;
 * 3. read the largest captured body back.
 *
 * Sentinel-verified: this path succeeds on ~98% of captioned videos.
 */
const READ_CAPTURED = (): string | null => {
  const w = window as unknown as { __yairCaptured?: Array<{ bytes: number; text: string }> };
  const caps = (w.__yairCaptured || []).filter((c) => c && c.bytes > 0);
  caps.sort((a, b) => b.bytes - a.bytes);
  return caps[0]?.text ?? null;
};

async function extractClientTranscript(
  tabId: number,
): Promise<ClientTranscriptPayload | null> {
  try {
    const token = `yair-${Math.random().toString(36).slice(2)}`;
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageInterceptor as (...args: unknown[]) => unknown,
      args: [{ token, source: "yair-rnd", patchFetch: true }],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: triggerCaptionRequest as (...args: unknown[]) => unknown,
      args: ["en"],
    });

    // Poll for a captured caption body (the request fires shortly after play).
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: READ_CAPTURED,
      });
      const json3 = results?.[0]?.result as string | null | undefined;
      if (json3) {
        return { videoId: "", language: "en", kind: "auto", json3 };
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log("[yair] no browser caption response captured; will fall back to server");
    return null;
  } catch (error) {
    console.warn("[yair] client transcript extraction failed", error);
    return null;
  }
}

async function storeClientTranscript(tabId: number, videoId: string): Promise<void> {
  const payload = await extractClientTranscript(tabId);
  if (!payload) return;
  payload.videoId = videoId;
  try {
    const stored = await chrome.storage.session.get(TRANSCRIPTS_KEY);
    const all = (stored[TRANSCRIPTS_KEY] as Record<string, ClientTranscriptPayload>) ?? {};
    all[videoId] = payload;
    await chrome.storage.session.set({ [TRANSCRIPTS_KEY]: all });
    console.log(`[yair] client transcript ready id=${videoId} (${payload.json3.length} chars)`);
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

const extractionTimers: Record<number, number> = {};

function scheduleExtraction(tabId: number | undefined, videoId: string, delay = 1500): void {
  if (tabId == null) return;
  const existing = extractionTimers[tabId];
  if (existing) clearTimeout(existing);
  extractionTimers[tabId] = setTimeout(() => {
    delete extractionTimers[tabId];
    void storeClientTranscript(tabId, videoId);
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
