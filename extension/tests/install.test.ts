import { beforeEach, describe, expect, it } from "vitest";

const store = new Map<string, unknown>();

beforeEach(() => {
  store.clear();
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: store.get(key) }),
        set: async (obj: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(obj)) store.set(key, value);
        },
      },
    },
  };
});

describe("getInstallId", () => {
  it("creates a stable 32-char id and persists it", async () => {
    const { getInstallId } = await import("../src/lib/install");
    const first = await getInstallId();
    const second = await getInstallId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(first).toBe(second);
    expect(store.get("yair.installId")).toBe(first);
  });
});
