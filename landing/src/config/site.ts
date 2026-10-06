/**
 * Central site configuration.
 *
 * Everything that needs to be replaced before launch lives in this file, so the
 * marketing surface can be updated without touching component code.
 */

export const SITE = {
  name: "YouTube AI Reader",
  tagline: "Read YouTube. Don't watch everything.",
  title: "YouTube AI Reader — Read, Search & Ask Any YouTube Video",
  description:
    "Turn YouTube videos into readable, searchable and interactive AI experiences. Get summaries, key ideas, chapters and grounded answers with timestamps.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://youtube-ai-reader.vercel.app",
  locale: "en_US",
} as const;

/**
 * TODO: Replace with your Chrome Web Store listing URL.
 *
 * This currently points at the Chrome Web Store home so every "Add to Chrome"
 * CTA resolves to a real page while the listing is pending. Do not invent an
 * extension id.
 */
export const CHROME_STORE_URL = "https://chromewebstore.google.com/";

/**
 * TODO: Set this to your authenticated web app / sign-in URL.
 *
 * Leave empty to fall back to the Chrome Web Store (auth happens inside the
 * extension). Do not implement auth on this marketing site.
 */
export const APP_URL = "";

/**
 * TODO: Replace with a real support address before launch.
 *
 * When left as the token below the UI renders a clearly marked placeholder
 * instead of inventing a contact address.
 */
export const SUPPORT_EMAIL = "CONTACT_EMAIL";

/**
 * TODO: Replace if you operate under a registered legal entity.
 *
 * When left as the token below, legal pages refer to the product name only and
 * never invent a company, address or registration number.
 */
export const LEGAL_ENTITY_NAME = "LEGAL_ENTITY_NAME";

const PLACEHOLDER_PATTERN = /^[A-Z_]+$/;

export function isConfigured(value: string): boolean {
  return value.length > 0 && !PLACEHOLDER_PATTERN.test(value);
}

export function supportEmailIsConfigured(): boolean {
  return isConfigured(SUPPORT_EMAIL) && SUPPORT_EMAIL.includes("@");
}

export function legalEntityIsConfigured(): boolean {
  return isConfigured(LEGAL_ENTITY_NAME);
}

/** Where every "Add to Chrome" CTA points. */
export const chromeStoreHref = CHROME_STORE_URL;

/** Where "Sign in" points; falls back to the extension listing. */
export function appHref(): string {
  return APP_URL.length > 0 ? APP_URL : CHROME_STORE_URL;
}

export const NAV_LINKS = [
  { label: "How it works", href: "/#how-it-works" },
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/#pricing" },
  { label: "FAQ", href: "/#faq" },
] as const;
