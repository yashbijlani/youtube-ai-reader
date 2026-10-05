#!/usr/bin/env node
/**
 * Method G feasibility probe: what speech/on-device-AI APIs does the actual
 * Chrome/Chromium build expose to pages and extensions?
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.goto("https://www.youtube.com/?hl=en", { waitUntil: "domcontentloaded", timeout: 45000 });
  const api = await page.evaluate(() => {
    const g = window;
    const check = (name) => {
      try {
        return typeof g[name];
      } catch {
        return "error";
      }
    };
    const builtIn = ["LanguageModel", "Translator", "Summarizer", "Writer", "Rewriter", "Proofreader", "ai", "model"];
    const speech = ["SpeechRecognition", "webkitSpeechRecognition", "SpeechSynthesis", "MediaRecorder"];
    return {
      builtInAI: Object.fromEntries(builtIn.map((k) => [k, check(k)])),
      speech: Object.fromEntries(speech.map((k) => [k, check(k)])),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory ?? null,
      secureContext: window.isSecureContext,
      crossOriginIsolated: window.crossOriginIsolated,
      webgpu: typeof navigator.gpu,
      wasm: typeof WebAssembly,
      wasmSimd: (() => {
        try {
          return WebAssembly.validate(
            new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
          );
        } catch {
          return false;
        }
      })(),
      wasmThreads: typeof SharedArrayBuffer,
    };
  });
  console.log(JSON.stringify(api, null, 2));
} finally {
  await browser.close();
}
