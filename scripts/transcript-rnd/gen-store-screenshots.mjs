#!/usr/bin/env node
/**
 * Generates Chrome Web Store screenshots (1280x800) from the live landing site.
 *
 *   node scripts/transcript-rnd/gen-store-screenshots.mjs
 *
 * Output: docs/store-assets/*.png
 */
import puppeteer from "puppeteer-core";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH || "/usr/bin/chromium";
const SITE = process.env.SITE || "https://youtube-ai-reader-mt4h.vercel.app";
const outDir = fileURLToPath(new URL("../../docs/store-assets", import.meta.url));
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(SITE, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(1500);

  const shots = [
    { name: "01-home", selector: null },
    { name: "02-features", selector: "#features" },
    { name: "03-pricing", selector: "#pricing" },
    { name: "04-faq", selector: "#faq" },
  ];
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
  });
  for (const shot of shots) {
    if (shot.selector) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY);
      }, shot.selector);
      await sleep(1500);
    }
    const scrollY = await page.evaluate(() => Math.round(window.scrollY));
    const file = `${outDir}/${shot.name}.png`;
    await page.screenshot({ path: file });
    console.log("wrote", file, "scrollY=" + scrollY);
  }
} finally {
  await browser.close();
}
