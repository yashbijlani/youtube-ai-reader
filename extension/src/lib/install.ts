const STORAGE_KEY = "yair.installId";

let cached: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Stable anonymous install id used for free-preview accounting. */
export async function getInstallId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const existing = stored[STORAGE_KEY] as string | undefined;
    if (existing) {
      cached = existing;
      return existing;
    }
    const created = randomId();
    await chrome.storage.local.set({ [STORAGE_KEY]: created });
    cached = created;
    return created;
  } catch {
    cached = cached ?? randomId();
    return cached;
  }
}
