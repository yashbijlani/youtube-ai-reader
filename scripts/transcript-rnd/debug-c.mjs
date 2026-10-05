#!/usr/bin/env node
import { launchBrowser, preparePage, warmUp, watchUrl, methodCIntercept, closeBrowser } from "./lib.mjs";

const id = process.argv[2] || "7ARBJQn6QkM";
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await preparePage(page, "dbg");
  await warmUp(page);
  await page.goto(watchUrl(id), { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.ytInitialPlayerResponse), { timeout: 20000 }).catch(() => {});

  const diag = await page.evaluate(() => ({
    interceptorInstalled: Boolean(window.__yairInterceptorInstalled),
    xhrName: window.XMLHttpRequest?.name,
    collectorReady: Array.isArray(window.__yairRnd),
  }));
  console.log("DIAG", JSON.stringify(diag));

  const res = await methodCIntercept(page, { timeoutMs: 25000 });
  console.log("RESULT", JSON.stringify({ success: res.success, latencyMs: res.latencyMs, via: res.via, bytes: res.bytes, meta: res.meta, error: res.error }));
  const raw = await page.evaluate(() => (window.__yairRnd || []).map((c) => ({ via: c.via, bytes: c.bytes, hasPot: c.hasPot })));
  console.log("RAW", JSON.stringify(raw));
} finally {
  await closeBrowser(browser);
}
