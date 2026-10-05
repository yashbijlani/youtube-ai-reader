import { sendMessage } from "./lib/messaging";
import { extractVideoId, watchUrlFor } from "./lib/youtube";
import type { VideoInfo } from "./types";

const HOST_ID = "yair-read-button-host";
const SPARKLE = "\u2728";

type ButtonState = "idle" | "loading" | "opened" | "error";

let currentVideoId: string | null = null;
let lastSentInfo = "";
let buttonState: ButtonState = "idle";
let lastTimeUpdate = 0;
let evaluateTimer: number | null = null;

// ------------------------------------------------------------- page info

function textOf(selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const text = element?.textContent?.trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return undefined;
}

function getVideoInfo(videoId: string): VideoInfo {
  const title =
    textOf([
      "ytd-watch-metadata h1.ytd-watch-metadata",
      "#title h1",
      "h1.ytd-watch-metadata",
    ]) ?? document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  const channel = textOf([
    "ytd-watch-metadata #owner #channel-name a",
    "#owner #channel-name a",
    "ytd-channel-name a",
    "#channel-name a",
  ]);
  const player = document.querySelector("video");
  const duration =
    player && Number.isFinite(player.duration) && player.duration > 0
      ? player.duration
      : undefined;
  return {
    videoId,
    url: watchUrlFor(videoId),
    title: title || undefined,
    channel: channel || undefined,
    duration,
  };
}

function notifyVideoChanged(force = false): void {
  if (!currentVideoId) return;
  const info = getVideoInfo(currentVideoId);
  const fingerprint = `${info.videoId}|${info.title ?? ""}|${info.channel ?? ""}`;
  if (!force && fingerprint === lastSentInfo) return;
  lastSentInfo = fingerprint;
  void sendMessage({ type: "VIDEO_CHANGED", video: info });
}

// -------------------------------------------------------------- the button

function findContainer(): HTMLElement | null {
  const selectors = [
    "ytd-watch-metadata #top-level-buttons-computed",
    "#actions-inner #top-level-buttons-computed",
    "#top-level-buttons-computed",
    "ytd-watch-metadata #actions",
    "#above-the-fold #actions",
    "#menu-container",
  ];
  for (const selector of selectors) {
    const element = document.querySelector<HTMLElement>(selector);
    if (element) return element;
  }
  return null;
}

function buildButtonHost(): HTMLElement {
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.display = "inline-flex";
  host.style.marginLeft = "8px";
  host.style.verticalAlign = "middle";

  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { display: inline-flex; }
      button {
        all: unset;
        display: inline-flex;
        align-items: center;
        gap: 7px;
        height: 36px;
        padding: 0 16px;
        border-radius: 18px;
        cursor: pointer;
        font: 500 14px/1 "YouTube Sans", Roboto, system-ui, -apple-system, sans-serif;
        background: #f2f2f2;
        color: #0f0f0f;
        white-space: nowrap;
        transition: background 0.15s ease, transform 0.05s ease, color 0.15s ease;
        box-sizing: border-box;
      }
      button:hover { background: #e5e5e5; }
      button:active { transform: scale(0.98); }
      button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 2px; }
      button[data-state="loading"] { pointer-events: none; opacity: 0.75; }
      button[data-state="opened"] { color: #cc0000; background: rgba(204, 0, 0, 0.08); }
      button[data-state="error"] { color: #cc0000; }
      .spinner {
        width: 13px;
        height: 13px;
        border: 2px solid currentColor;
        border-top-color: transparent;
        border-radius: 50%;
        animation: yair-spin 0.7s linear infinite;
      }
      @keyframes yair-spin { to { transform: rotate(360deg); } }
      :host-context(html[dark]) button { background: #272727; color: #f1f1f1; }
      :host-context(html[dark]) button:hover { background: #3f3f3f; }
      :host-context(html[dark]) button[data-state="opened"] {
        color: #ff6b6b; background: rgba(255, 107, 107, 0.12);
      }
    </style>
    <button type="button" data-state="idle" aria-label="Read this video with AI">
      <span class="icon">${SPARKLE}</span><span class="label">Read with AI</span>
    </button>
  `;
  shadow.querySelector("button")?.addEventListener("click", () => void onButtonClick());
  return host;
}

function setButtonState(host: HTMLElement, state: ButtonState): void {
  buttonState = state;
  const shadow = host.shadowRoot;
  if (!shadow) return;
  const button = shadow.querySelector("button");
  const icon = shadow.querySelector(".icon");
  const label = shadow.querySelector(".label");
  if (!button || !icon || !label) return;
  button.dataset.state = state;
  switch (state) {
    case "idle":
      icon.textContent = SPARKLE;
      label.textContent = "Read with AI";
      break;
    case "loading":
      icon.innerHTML = '<span class="spinner"></span>';
      label.textContent = "Opening…";
      break;
    case "opened":
      icon.textContent = SPARKLE;
      label.textContent = "Read with AI";
      break;
    case "error":
      icon.textContent = SPARKLE;
      label.textContent = "Try again";
      break;
  }
}

async function onButtonClick(): Promise<void> {
  if (!currentVideoId || buttonState === "loading") return;
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  setButtonState(host, "loading");
  const info = getVideoInfo(currentVideoId);
  const response = await sendMessage<{ ok?: boolean; opened?: boolean }>({
    type: "READ_WITH_AI_REQUESTED",
    video: info,
  });
  if (response?.ok && response.opened !== false) {
    setButtonState(host, "opened");
    window.setTimeout(() => setButtonState(host, "idle"), 2600);
  } else {
    setButtonState(host, "error");
    window.setTimeout(() => setButtonState(host, "idle"), 2600);
  }
}

function removeButton(): void {
  document.getElementById(HOST_ID)?.remove();
}

function ensureButton(): void {
  if (!currentVideoId || location.pathname !== "/watch") {
    removeButton();
    return;
  }
  const container = findContainer();
  if (!container) return;
  const existing = document.getElementById(HOST_ID);
  if (existing && existing.isConnected && existing.parentElement === container) {
    return;
  }
  const host = existing ?? buildButtonHost();
  if (existing && existing.parentElement !== container) existing.remove();
  if (!host.isConnected) {
    container.appendChild(host);
  }
  setButtonState(host, buttonState);
}

let ensureScheduled = false;
function scheduleEnsure(delay = 250): void {
  if (ensureScheduled) return;
  ensureScheduled = true;
  window.setTimeout(() => {
    ensureScheduled = false;
    ensureButton();
  }, delay);
}

// ------------------------------------------------------------ navigation

function evaluatePage(): void {
  const id = extractVideoId(location.href);
  if (id !== currentVideoId) {
    currentVideoId = id;
    lastSentInfo = "";
    if (id) {
      notifyVideoChanged(true);
      scheduleEnsure(150);
    } else {
      void sendMessage({ type: "VIDEO_CHANGED", video: null });
      removeButton();
    }
    return;
  }
  if (id) {
    notifyVideoChanged(false);
    ensureButton();
  }
}

window.addEventListener("yt-navigate-finish", () => scheduleEvaluate());
window.addEventListener("popstate", () => scheduleEvaluate());
window.addEventListener("yt-page-data-updated", () => scheduleEvaluate());

function scheduleEvaluate(delay = 300): void {
  if (evaluateTimer != null) window.clearTimeout(evaluateTimer);
  evaluateTimer = window.setTimeout(() => {
    evaluateTimer = null;
    evaluatePage();
  }, delay);
}

// ---------------------------------------------------------------- seeking

function seekTo(seconds: number): boolean {
  const safe = Math.max(0, Number(seconds) || 0);
  const player = document.getElementById("movie_player") as
    | (HTMLElement & { seekTo?: (seconds: number, allowSeekAhead: boolean) => void })
    | null;
  if (player && typeof player.seekTo === "function") {
    player.seekTo(safe, true);
    return true;
  }
  const video = document.querySelector("video");
  if (video) {
    video.currentTime = safe;
    void video.play().catch(() => undefined);
    return true;
  }
  return false;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SEEK_TO") {
    sendResponse({ ok: seekTo(message.seconds) });
  }
  return false;
});

// ---------------------------------------------------- caption capture bridge
// The MAIN-world interceptor (interceptor.js) posts the player's own caption
// response. Forward it to the background as a second, independent capture
// channel so acquisition does not depend solely on chrome.scripting reads.
// Security: validate source/type and forward only the caption text.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data as
    | { source?: string; type?: string; text?: unknown; hasPot?: unknown; paramKeys?: unknown }
    | undefined;
  if (!data || data.source !== "yair-rnd" || data.type !== "caption") return;
  if (typeof data.text !== "string" || data.text.length === 0) return;
  if (!currentVideoId) return;
  void sendMessage({
    type: "CAPTION_CAPTURED",
    videoId: currentVideoId,
    text: data.text,
    hasPot: Boolean(data.hasPot),
    bytes: data.text.length,
    paramKeys: Array.isArray(data.paramKeys) ? (data.paramKeys as string[]) : [],
  });
});

// ------------------------------------------------------------- playback

document.addEventListener(
  "timeupdate",
  (event) => {
    const target = event.target as HTMLVideoElement | null;
    if (!target || target.tagName !== "VIDEO" || !currentVideoId) return;
    const now = Date.now();
    if (now - lastTimeUpdate < 1000) return;
    lastTimeUpdate = now;
    void sendMessage({
      type: "PLAYBACK_TIME",
      videoId: currentVideoId,
      seconds: target.currentTime,
    });
  },
  true,
);

// ------------------------------------------------------------- lifecycle

const observer = new MutationObserver(() => scheduleEnsure(400));
observer.observe(document.documentElement, { childList: true, subtree: true });

window.setInterval(() => {
  evaluatePage();
  scheduleEnsure(50);
}, 2000);

scheduleEvaluate(0);

export {};
