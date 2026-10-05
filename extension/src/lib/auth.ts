/**
 * Supabase Auth session management for the extension.
 *
 * Talks to Supabase's REST auth endpoints directly (no SDK dependency) and
 * persists the session in `chrome.storage.local`. Access tokens are refreshed
 * lazily before they expire. The backend verifies the JWT; the client never
 * decides identity or entitlement.
 */

const STORAGE_KEY = "yair.auth.session";

const SUPABASE_URL: string =
  (import.meta.env?.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_ANON_KEY: string =
  (import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined) ?? "";

export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  user: AuthUser;
}

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { id: string; email?: string | null };
}

const listeners = new Set<(session: AuthSession | null) => void>();

function notify(session: AuthSession | null): void {
  for (const listener of listeners) {
    try {
      listener(session);
    } catch {
      // listeners must not break auth
    }
  }
}

export function onAuthChange(listener: (session: AuthSession | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function persist(session: AuthSession | null): Promise<void> {
  try {
    if (session) {
      await chrome.storage.local.set({ [STORAGE_KEY]: session });
    } else {
      await chrome.storage.local.remove(STORAGE_KEY);
    }
  } catch {
    // storage is best-effort
  }
}

function toSession(data: SupabaseTokenResponse, fallbackUser?: AuthUser): AuthSession {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: {
      id: data.user?.id ?? fallbackUser?.id ?? "",
      email: data.user?.email ?? fallbackUser?.email ?? null,
    },
  };
}

export async function getSession(): Promise<AuthSession | null> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const session = stored[STORAGE_KEY] as AuthSession | undefined;
    return session?.accessToken ? session : null;
  } catch {
    return null;
  }
}

async function authEndpoint(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function readError(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return (
      body?.error_description ||
      body?.msg ||
      body?.message ||
      `Authentication failed (HTTP ${response.status}).`
    );
  } catch {
    return `Authentication failed (HTTP ${response.status}).`;
  }
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  if (!authConfigured) throw new Error("Sign-in is not configured for this build.");
  const response = await authEndpoint("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const session = toSession((await response.json()) as SupabaseTokenResponse);
  await persist(session);
  notify(session);
  return session;
}

export async function signUp(
  email: string,
  password: string,
): Promise<{ session: AuthSession | null; needsConfirmation: boolean }> {
  if (!authConfigured) throw new Error("Sign-up is not configured for this build.");
  const response = await authEndpoint("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const data = (await response.json()) as SupabaseTokenResponse & { user?: { id: string; email?: string } };
  if (!data.access_token) {
    return { session: null, needsConfirmation: true };
  }
  const session = toSession(data);
  await persist(session);
  notify(session);
  return { session, needsConfirmation: false };
}

async function refresh(session: AuthSession): Promise<AuthSession | null> {
  const response = await authEndpoint("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!response.ok) {
    await persist(null);
    notify(null);
    return null;
  }
  const next = toSession((await response.json()) as SupabaseTokenResponse, session.user);
  await persist(next);
  notify(next);
  return next;
}

/** Return a valid access token, refreshing it if it expires within 60s. */
export async function getAccessToken(): Promise<string | null> {
  const session = await getSession();
  if (!session) return null;
  if (session.expiresAt - Date.now() > 60_000) return session.accessToken;
  const next = await refresh(session).catch(() => null);
  return next?.accessToken ?? null;
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session && authConfigured) {
    await authEndpoint("/auth/v1/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    }).catch(() => undefined);
  }
  await persist(null);
  notify(null);
}
