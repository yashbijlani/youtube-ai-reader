import { beforeEach, describe, expect, it, vi } from "vitest";

vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

const storage = new Map<string, unknown>();
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => (storage.has(key) ? { [key]: storage.get(key) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
      remove: async (key: string) => {
        storage.delete(key);
      },
    },
  },
};

const auth = await import("../src/lib/auth");
const { api } = await import("../src/lib/api");

const BASE = "http://127.0.0.1:8000";

function sessionResponse(accessToken: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: accessToken,
      refresh_token: "r1",
      expires_in: 3600,
      user: { id: "user-1", email: "a@b.com" },
    }),
  } as unknown as Response;
}

const ACCOUNT = {
  authenticated: true,
  user: { id: "user-1", email: "a@b.com", plan: "free" },
  subscription: { status: "FREE", plan: "free", active: false },
  usage: {
    period: "2026-10",
    videos_used: 1,
    chat_messages: 0,
    ai_cost_usd: 0,
    lifetime_videos: 1,
    free_limit: 3,
    free_monthly_limit: 5,
  },
};

describe("authenticated API requests", () => {
  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("attaches the Supabase bearer token to /api/me", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sessionResponse("access-token-1")));
    await auth.signIn("a@b.com", "secret");

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ACCOUNT,
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const me = await api.me(BASE);
    expect(me.authenticated).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer access-token-1");
  });

  it("sends no Authorization header when signed out", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...ACCOUNT, authenticated: false }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    await api.me(BASE);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
