import { beforeEach, describe, expect, it, vi } from "vitest";

// Stub env + chrome.storage before importing the module (module-level constants).
vi.stubEnv("VITE_SUPABASE_URL", "https://proj.supabase.co");
vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon-key");

const storage = new Map<string, unknown>();
const launchWebAuthFlow = vi.fn();
const chromeMock = {
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
  identity: {
    getRedirectURL: (path?: string) => `https://extension.chromiumapp.org/${path ?? ""}`,
    launchWebAuthFlow,
  },
};
(globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

const auth = await import("../src/lib/auth");

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: accessToken,
      refresh_token: "refresh-1",
      expires_in: expiresIn,
      user: {
        id: "user-1",
        email: "a@b.com",
        user_metadata: { full_name: "Ada Lovelace", avatar_url: "https://example.com/a.png" },
      },
    }),
  } as unknown as Response;
}

function userResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: "user-1",
      email: "a@b.com",
      user_metadata: { full_name: "Ada Lovelace", avatar_url: "https://example.com/a.png" },
    }),
  } as unknown as Response;
}

describe("extension auth session", () => {
  beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
  });

  it("is configured when env is present", () => {
    expect(auth.authConfigured).toBe(true);
  });

  it("signs in, persists the session, and returns a token", async () => {
    const fetchMock = vi.fn(async () => tokenResponse("access-1"));
    vi.stubGlobal("fetch", fetchMock);
    const session = await auth.signIn("a@b.com", "secret");
    expect(session.accessToken).toBe("access-1");
    expect(session.user.email).toBe("a@b.com");
    expect(await auth.getSession()).not.toBeNull();
    const sent = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(sent[0])).toContain("/auth/v1/token?grant_type=password");
    expect(sent[1].headers).toMatchObject({ apikey: "anon-key" });
  });

  it("returns the access token without refreshing when valid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse("access-1")));
    await auth.signIn("a@b.com", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await auth.getAccessToken()).toBe("access-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes an expiring token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(tokenResponse("access-1", -10)) // already expired
      .mockResolvedValueOnce(tokenResponse("access-2"));
    vi.stubGlobal("fetch", fetchMock);
    await auth.signIn("a@b.com", "secret");
    const token = await auth.getAccessToken();
    expect(token).toBe("access-2");
    expect(String(fetchMock.mock.calls[1][0])).toContain("grant_type=refresh_token");
  });

  it("clears the session on sign out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse("access-1")));
    await auth.signIn("a@b.com", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response));
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
  });

  it("restores a persisted session", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => tokenResponse("access-1")));
    await auth.signIn("a@b.com", "secret");
    const restored = await auth.getSession();
    expect(restored?.user.name).toBe("Ada Lovelace");
    expect(restored?.user.avatarUrl).toBe("https://example.com/a.png");
  });
});

describe("Google sign-in", () => {
  beforeEach(() => {
    storage.clear();
    launchWebAuthFlow.mockReset();
    vi.restoreAllMocks();
  });

  it("completes the PKCE flow with an authorization code", async () => {
    launchWebAuthFlow.mockResolvedValue(
      `${auth.getOAuthRedirectUrl()}?code=auth-code-123`,
    );
    const fetchMock = vi.fn(async () => tokenResponse("google-access"));
    vi.stubGlobal("fetch", fetchMock);

    const session = await auth.signInWithGoogle();
    expect(session.accessToken).toBe("google-access");
    expect(session.user.email).toBe("a@b.com");

    // Authorize URL was opened with provider=google + PKCE challenge.
    const opened = (launchWebAuthFlow.mock.calls[0][0] as { url: string }).url;
    expect(opened).toContain("provider=google");
    expect(opened).toContain("code_challenge=");
    expect(opened).toContain("code_challenge_method=S256");
    expect(opened).toContain(encodeURIComponent(auth.getOAuthRedirectUrl()));

    // PKCE exchange happened server-side.
    const sent = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(sent[0])).toContain("grant_type=pkce");
    expect(JSON.parse(sent[1].body as string)).toMatchObject({
      auth_code: "auth-code-123",
    });
  });

  it("handles the implicit fragment flow and loads the profile", async () => {
    launchWebAuthFlow.mockResolvedValue(
      `${auth.getOAuthRedirectUrl()}#access_token=implicit-token&refresh_token=r2&expires_in=3600`,
    );
    const fetchMock = vi.fn(async () => userResponse());
    vi.stubGlobal("fetch", fetchMock);

    const session = await auth.signInWithGoogle();
    expect(session.accessToken).toBe("implicit-token");
    expect(session.user.name).toBe("Ada Lovelace");
    const sent = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(sent[0])).toContain("/auth/v1/user");
    expect(await auth.getSession()).not.toBeNull();
  });

  it("surfaces OAuth errors", async () => {
    launchWebAuthFlow.mockResolvedValue(
      `${auth.getOAuthRedirectUrl()}?error=access_denied&error_description=Denied`,
    );
    await expect(auth.signInWithGoogle()).rejects.toThrow(/Denied/);
  });

  it("rejects when the flow is dismissed", async () => {
    launchWebAuthFlow.mockResolvedValue(undefined);
    await expect(auth.signInWithGoogle()).rejects.toThrow(/cancelled/i);
  });
});
