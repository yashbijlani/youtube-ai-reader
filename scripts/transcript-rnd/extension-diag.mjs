#!/usr/bin/env node
/**
 * Extension diagnostics: load the built extension, open a YouTube video, and
 * check (a) the MAIN-world interceptor works without breaking XMLHttpRequest,
 * (b) the service worker can reach the deployed backend.
 */
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const BACKEND = process.env.BACKEND || "https://youtube-ai-reader.onrender.com";
const VIDEO = process.env.VIDEO || "aircAruvnKk";
const dist = fileURLToPath(new URL("../../extension/dist", import.meta.url));
if (!existsSync(dist)) {
  console.error("extension/dist not found");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  userDataDir: process.env.USER_DATA_DIR || "/tmp/opencode/chrome-ext-diag",
  args: [
    "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio",
    "--disable-blink-features=AutomationControlled",
    `--disable-extensions-except=${dist}`, `--load-extension=${dist}`,
  ],
});

try {
  const swTarget = await browser.waitForTarget(
    (t) => t.type() === "service_worker" && t.url().startsWith("chrome-extension://"),
    { timeout: 15000 },
  );
  console.log("service worker:", swTarget.url());
  const worker = await swTarget.worker();

  // ---- (a) interceptor + no XHR breakage on a real page
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push("[console] " + m.text().slice(0, 160));
  });
  await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36");
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`https://www.youtube.com/watch?v=${VIDEO}&hl=en&has_verified=1&cc_load_policy=1`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const xhrCheck = await page.evaluate(() => {
    const x = window.XMLHttpRequest;
    return {
      installed: Boolean(window.__yairInterceptorInstalled),
      typeName: typeof x,
      DONE: x && x.DONE,
      hasOpen: Boolean(x && x.prototype && x.prototype.open),
    };
  });
  await page.evaluate(() => {
    const p = document.querySelector("#movie_player");
    try { p?.setOption?.("captions", "track", { languageCode: "en" }); } catch {}
    document.querySelector(".ytp-subtitles-button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    try { p?.playVideo?.(); } catch {}
  });
  let captures = [];
  for (let i = 0; i < 24; i += 1) {
    captures = await page.evaluate(() => (window.__yairCaptured || []).map((c) => c.bytes));
    if (captures.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("xhrCheck:", JSON.stringify(xhrCheck));
  const button = await page.evaluate(() => {
    const host = document.getElementById("yair-read-button-host");
    const btn = host?.shadowRoot?.querySelector("button");
    return { host: Boolean(host), label: btn?.textContent?.trim() ?? null };
  });
  console.log("button:", JSON.stringify(button));
  console.log("captures:", JSON.stringify(captures));
  console.log("page errors:", JSON.stringify(pageErrors.slice(0, 8)));

  // ---- (b) service worker -> deployed backend
  const probe = await worker.evaluate(async (backend) => {
    const out = {};
    for (const path of ["/api/health", "/api/me"]) {
      try {
        const r = await fetch(backend + path, { headers: { "X-Install-Id": "diag-install-1" } });
        out[path] = { status: r.status, body: (await r.text()).slice(0, 200) };
      } catch (e) {
        out[path] = { error: String(e).slice(0, 200) };
      }
    }
    return out;
  }, BACKEND);
  console.log("SW -> backend:", JSON.stringify(probe, null, 1));

  // ---- (c) exercise the real background extraction path (as the side panel does)
  const extId = swTarget.url().split("/")[2];
  const extPage = await browser.newPage();
  await extPage.goto(`chrome-extension://${extId}/sidepanel.html`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const bg = await extPage
    .evaluate(async (videoId) => {
      const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*"] });
      const yt = tabs.find((t) => (t.url || "").includes(`watch?v=${videoId}`));
      if (!yt?.id) return { error: "no youtube tab", tabs: tabs.map((t) => t.url) };
      const r = await chrome.runtime.sendMessage({
        type: "EXTRACT_CLIENT_TRANSCRIPT",
        videoId,
        tabId: yt.id,
      });
      return {
        status: r?.status,
        method: r?.payload?.method,
        format: r?.payload?.format,
        contentLen: r?.payload?.content?.length ?? null,
        segments: r?.payload?.segments?.length ?? null,
        error: r?.error ?? r?.message ?? null,
      };
    }, VIDEO)
    .catch((e) => ({ evalError: String(e).slice(0, 200) }));
  console.log("background EXTRACT:", JSON.stringify(bg));
} finally {
  await browser.close();
}
