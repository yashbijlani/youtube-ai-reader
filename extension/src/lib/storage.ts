export interface Settings {
  apiBaseUrl: string;
}

export const DEFAULT_API_BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8000";

const STORAGE_KEY = "yair.settings";

export async function getSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY] as Partial<Settings> | undefined;
    return {
      apiBaseUrl: value?.apiBaseUrl?.trim() || DEFAULT_API_BASE_URL,
    };
  } catch {
    return { apiBaseUrl: DEFAULT_API_BASE_URL };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

export async function resetSettings(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}
