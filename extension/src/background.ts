import { BrowserTranscriptProvider, toClientPayload } from "./transcript-rnd/browser-provider";
import { normalizeSegments, parseJson3 } from "./transcript-rnd/parseJson3";
import { isYouTubeUrl, resolveVideoInfo } from "./lib/context";
import type {
  BackgroundBroadcast,
  ClientTranscriptPayload,
  ContentToBackground,
  PanelToBackground,
  TranscriptExtractionResult,
  VideoContextSnapshot,
  VideoInfo,
} from "./types";

const TRANSCRIPTS_KEY = "yair.clientTranscripts";
const PANEL_PATH = "sidepanel.html";
const ACTION_TITLE_YT = "YouTube AI Reader";
const ACTION_TITLE_OTHER = "Open a YouTube video to use YouTube AI Reader";
const BUILD = "b1";
const API_BASE = (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "(default)";
console.log(`[yair] background ready build=${BUILD} backend=${API_BASE}`);

interface TabContext {
  video: VideoInfo | null;
  playbackSeconds: number | null;
  requestedVideoId: string | null;
  updatedAt: number;
}

/**
 * Per-tab context. The background is shared across tabs, so keying by tab id is
 * essential — a single global context would leak one tab's video into another
 * panel (or a stale value across service-worker restarts).
 */
const tabStates: Record<number, TabContext> = {};

function ensureTab(tabId: number): TabContext {
  let ctx = tabStates[tabId];
  if (!ctx) {
    ctx = { video: null, playbackSeconds: null, requestedVideoId: null, updatedAt: Date.now() };
    tabStates[tabId] = ctx;
  }
  return ctx;
}

async function tabUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ?? null;
  } catch {
    return null;
  }
}

/** The active tab of the panel's window, or the focused window. */
async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) return tab.id;
    const [fallback] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return fallback?.id ?? null;
  } catch {
    return null;
  }
}

async function snapshotForTab(
  tabId: number | null,
): Promise<VideoContextSnapshot & { requestedVideoId: string | null }> {
  if (tabId == null) {
    return { video: null, playbackSeconds: null, updatedAt: 0, requestedVideoId: null };
  }
  const url = await tabUrl(tabId);
  const ctx = tabStates[tabId];
  const video = resolveVideoInfo(ctx?.video ?? null, url);
  if (ctx && video && ctx.video?.videoId !== video.videoId) {
    // URL disagrees with the stored context — trust the URL.
    ctx.video = video;
    ctx.playbackSeconds = null;
  }
  return {
    video,
    playbackSeconds: ctx?.playbackSeconds ?? null,
    updatedAt: ctx?.updatedAt ?? Date.now(),
    requestedVideoId: ctx?.requestedVideoId ?? null,
  };
}

function broadcast(tabId: number | null, requestedVideoId: string | null = null): void {
  void (async () => {
    const context = await snapshotForTab(tabId);
    const message: BackgroundBroadcast = {
      type: "CONTEXT_UPDATED",
      tabId,
      context: { video: context.video, playbackSeconds: context.playbackSeconds, updatedAt: context.updatedAt },
      requestedVideoId: requestedVideoId ?? context.requestedVideoId,
    };
    chrome.runtime.sendMessage(message).catch(() => {
      // No side panel open; nothing to notify.
    });
  })();
}

let lastPlaybackBroadcast = 0;
function broadcastPlaybackThrottled(tabId: number | null): void {
  const now = Date.now();
  if (now - lastPlaybackBroadcast < 900) return;
  lastPlaybackBroadcast = now;
  broadcast(tabId);
}

/**
 * Production browser transcript acquisition (R&D-verified).
 *
 * Fallback chain:
 *   1. MAIN-world interception of YouTube's own signed `/api/timedtext`
 *      response (primary; full timestamps).
 *   2. Rendered caption DOM capture (lossy, real-time).
 * Server yt-dlp remains the caller's fallback when this returns null.
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

// Captures forwarded by the content-script bridge (independent of the
// chrome.scripting read path). Keyed by tab; validated against the video id.
interface PendingCapture {
  videoId: string | null;
  text: string;
  at: number;
}
const pendingCaptures: Record<number, PendingCapture> = {};

function pendingPayload(tabId: number, videoId: string): ClientTranscriptPayload | null {
  const pending = pendingCaptures[tabId];
  if (!pending || !pending.text) return null;
  if (pending.videoId && pending.videoId !== videoId) return null;
  const segments = normalizeSegments(parseJson3(pending.text));
  if (segments.length === 0) return null;
  return {
    videoId,
    language: "en",
    kind: "auto",
    format: "json3",
    content: pending.text,
    method: "browser_intercept",
  };
}

// In-flight extractions, keyed by tab + video, so a pre-extraction on navigation
// and an awaited request from the panel share one capture instead of racing —
// and one video's request never returns another video's capture.
const extractionInflight: Record<string, Promise<TranscriptExtractionResult>> = {};

interface ExtractTiming {
  interceptTimeoutMs?: number;
  domFallbackMs?: number;
}

function extractAndStore(
  tabId: number,
  videoId: string,
  timing: ExtractTiming = {},
): Promise<TranscriptExtractionResult> {
  const inflightKey = `${tabId}:${videoId}`;
  const existing = extractionInflight[inflightKey];
  if (existing) return existing;
  const task = (async (): Promise<TranscriptExtractionResult> => {
    try {
      const result = await browserProvider.extract(tabId, {
        prefLang: "en",
        videoId,
        interceptTimeoutMs: timing.interceptTimeoutMs ?? 15000,
        domFallbackMs: timing.domFallbackMs ?? 8000,
      });
      if (!result) {
        console.log("[yair] no browser captions found; server fallback will handle it");
        return { status: "no_captions" };
      }
      const payload = toClientPayload(result, videoId);
      await storeClientTranscript(videoId, payload);
      return { status: "ok", payload };
    } catch (error) {
      console.warn("[yair] browser transcript extraction failed", error);
      return { status: "error", message: (error as Error).message };
    }
  })().finally(() => {
    delete extractionInflight[inflightKey];
  });
  extractionInflight[inflightKey] = task;
  return task;
}

// Drop page-visible captures that belong to a *different* video, keeping any
// that already arrived for the requested one. Clearing everything on navigation
// could wipe a capture that landed just after the URL changed.
const RESET_PAGE_CAPTURES = (videoId: string): void => {
  try {
    const w = window as unknown as {
      __yairCaptured?: Array<{ videoId?: string; pageVideoId?: string }>;
    };
    w.__yairCaptured = (w.__yairCaptured || []).filter(
      (c) => c && (c.videoId === videoId || c.pageVideoId === videoId),
    );
  } catch {
    /* ignore */
  }
};

/** Hard-reset the capture buffer (used before a fresh retry pass). */
const RESET_ALL_CAPTURES = (): void => {
  try {
    (window as unknown as { __yairCaptured?: unknown[] }).__yairCaptured = [];
  } catch {
    /* ignore */
  }
};

async function clearPageCaptures(tabId: number, videoId = ""): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: RESET_PAGE_CAPTURES,
      args: [videoId],
    });
  } catch {
    /* ignore */
  }
}

async function clearAllPageCaptures(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: RESET_ALL_CAPTURES,
    });
  } catch {
    /* ignore */
  }
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
      const id = await activeTabId();
      if (id != null) await chrome.sidePanel.open({ tabId: id });
    }
    return true;
  } catch (error) {
    console.warn("[yair] sidePanel.open failed", error);
    return false;
  }
}

async function seekTo(seconds: number, tabId?: number | null): Promise<boolean> {
  const candidates: number[] = [];
  if (tabId != null) candidates.push(tabId);
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
  for (const id of candidates) {
    try {
      const response = (await chrome.tabs.sendMessage(id, {
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

async function resolvePanelTab(requested: number | null | undefined): Promise<number | null> {
  if (requested != null) return requested;
  return activeTabId();
}

async function handle(
  message: ContentToBackground | PanelToBackground | { type: "PING" },
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case "VIDEO_CHANGED": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false };
      const ctx = ensureTab(tabId);
      ctx.video = message.video;
      ctx.requestedVideoId = null;
      if (!message.video) ctx.playbackSeconds = null;
      ctx.updatedAt = Date.now();
      delete pendingCaptures[tabId];
      void clearPageCaptures(tabId, message.video?.videoId ?? "");
      broadcast(tabId, null);
      if (message.video) scheduleExtraction(tabId, message.video.videoId);
      return { ok: true };
    }
    case "PLAYBACK_TIME": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: true };
      const ctx = ensureTab(tabId);
      ctx.playbackSeconds = message.seconds;
      ctx.updatedAt = Date.now();
      if (ctx.video?.videoId !== message.videoId) {
        // Reconcile a stale context using the reporting tab.
        const url = await tabUrl(tabId);
        const video = resolveVideoInfo(ctx.video, url);
        ctx.video = video && video.videoId === message.videoId ? video : ctx.video;
      }
      broadcastPlaybackThrottled(tabId);
      return { ok: true };
    }
    case "READ_WITH_AI_REQUESTED": {
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: false };
      const ctx = ensureTab(tabId);
      ctx.video = message.video;
      ctx.requestedVideoId = message.video.videoId;
      ctx.updatedAt = Date.now();
      scheduleExtraction(tabId, message.video.videoId, 0);
      const opened = await openPanel(tabId);
      broadcast(tabId, message.video.videoId);
      return { ok: true, opened };
    }
    case "GET_CONTEXT": {
      const tabId = await resolvePanelTab(message.tabId);
      const snapshot = await snapshotForTab(tabId);
      return {
        video: snapshot.video,
        playbackSeconds: snapshot.playbackSeconds,
        updatedAt: snapshot.updatedAt,
        requestedVideoId: snapshot.requestedVideoId,
        tabId,
      };
    }
    case "GET_CLIENT_TRANSCRIPT":
      return getClientTranscript(message.videoId);
    case "CAPTION_CAPTURED": {
      const tabId = sender.tab?.id;
      if (tabId == null || typeof message.text !== "string" || message.text.length === 0) {
        return { ok: false };
      }
      pendingCaptures[tabId] = { videoId: message.videoId ?? null, text: message.text, at: Date.now() };
      return { ok: true };
    }
    case "EXTRACT_CLIENT_TRANSCRIPT": {
      const tabId = await resolvePanelTab(message.tabId ?? sender.tab?.id);
      const cached = await getClientTranscript(message.videoId);
      if (cached) return { status: "ok", payload: cached } satisfies TranscriptExtractionResult;
      if (tabId == null) {
        return { status: "error", message: "No active YouTube tab." } satisfies TranscriptExtractionResult;
      }
      // Fast path: the content-script bridge may already have the capture.
      const bridged = pendingPayload(tabId, message.videoId);
      if (bridged) {
        await storeClientTranscript(message.videoId, bridged);
        return { status: "ok", payload: bridged } satisfies TranscriptExtractionResult;
      }
      let result = await extractAndStore(tabId, message.videoId);
      if (result.status !== "ok") {
        // Bridge may have arrived while the scripting path was polling.
        const late = pendingPayload(tabId, message.videoId);
        if (late) {
          await storeClientTranscript(message.videoId, late);
          return { status: "ok", payload: late } satisfies TranscriptExtractionResult;
        }
        // Retry once with a clean buffer and fresh triggers before ever falling
        // back to the server. This is the safety net for an unlucky first pass.
        console.warn("[yair] first capture pass found nothing; retrying browser capture");
        await clearAllPageCaptures(tabId);
        await new Promise((resolve) => setTimeout(resolve, 500));
        result = await extractAndStore(tabId, message.videoId, {
          interceptTimeoutMs: 12000,
          domFallbackMs: 6000,
        });
        if (result.status !== "ok") {
          const late2 = pendingPayload(tabId, message.videoId);
          if (late2) {
            await storeClientTranscript(message.videoId, late2);
            return { status: "ok", payload: late2 } satisfies TranscriptExtractionResult;
          }
        }
      }
      return result;
    }
    case "CONSUME_REQUEST": {
      const tabId = await resolvePanelTab(message.tabId);
      if (tabId != null && tabStates[tabId]) tabStates[tabId].requestedVideoId = null;
      return { ok: true };
    }
    case "SEEK_TO":
      return { ok: await seekTo(message.seconds, message.tabId) };
    case "OPEN_PANEL":
      return { ok: await openPanel(sender.tab?.id ?? message.tabId ?? undefined) };
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

/**
 * Enable the action and side panel only on YouTube. On other tabs the side panel
 * is disabled, so Chrome closes/hides it there and it can't be opened off-YouTube
 * (previously it lingered on every tab, needing to be closed repeatedly).
 */
function configureTab(tabId: number, url: string | null | undefined): void {
  const youtube = isYouTubeUrl(url ?? "");
  chrome.sidePanel
    .setOptions({ tabId, path: PANEL_PATH, enabled: youtube })
    .catch(() => undefined);
  if (youtube) {
    chrome.action.enable(tabId).catch(() => undefined);
    chrome.action.setTitle({ tabId, title: ACTION_TITLE_YT }).catch(() => undefined);
  } else {
    chrome.action.disable(tabId).catch(() => undefined);
    chrome.action.setTitle({ tabId, title: ACTION_TITLE_OTHER }).catch(() => undefined);
  }
}

function configureAllTabs(): void {
  chrome.tabs
    .query({})
    .then((tabs) => {
      for (const tab of tabs) if (tab.id != null) configureTab(tab.id, tab.url);
    })
    .catch(() => undefined);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    configureTab(tabId, tab.url);
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => configureTab(tabId, tab.url))
    .catch(() => undefined);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabStates[tabId];
  delete extractionTimers[tabId];
  delete pendingCaptures[tabId];
  for (const key of Object.keys(extractionInflight)) {
    if (key.startsWith(`${tabId}:`)) delete extractionInflight[key];
  }
});

function configurePanelBehavior(): void {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.warn("[yair] setPanelBehavior failed", error));
}

function cleanupStaleStorage(): void {
  // Remove the old global context (from the retired single-context design) and
  // any session-cached client transcripts, so a bad capture from an earlier
  // bug can never be re-ingested.
  chrome.storage.session.remove(["yair.context", TRANSCRIPTS_KEY]).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
  cleanupStaleStorage();
  configureAllTabs();
});
chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
  cleanupStaleStorage();
  configureAllTabs();
});
configurePanelBehavior();
cleanupStaleStorage();
configureAllTabs();
