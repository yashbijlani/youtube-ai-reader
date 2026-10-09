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
  name?: string | null;
  avatarUrl?: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  user: AuthUser;
}

interface SupabaseUser {
  id: string;
  email?: string | null;
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    picture?: string;
  };
}

interface SupabaseTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user?: SupabaseUser;
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

function toAuthUser(user: SupabaseUser | undefined, fallback?: AuthUser): AuthUser {
  const meta = user?.user_metadata ?? {};
  return {
    id: user?.id ?? fallback?.id ?? "",
    email: user?.email ?? fallback?.email ?? null,
    name: meta.full_name || meta.name || fallback?.name || null,
    avatarUrl: meta.avatar_url || meta.picture || fallback?.avatarUrl || null,
  };
}

function toSession(data: SupabaseTokenResponse, fallbackUser?: AuthUser): AuthSession {
  return {
    accessToken: data.access_token ?? "",
    refreshToken: data.refresh_token ?? "",
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    user: toAuthUser(data.user, fallbackUser),
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

// --------------------------------------------------------------- Google OAuth

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The OAuth redirect URL that must be allow-listed in Supabase. */
export function getOAuthRedirectUrl(): string {
  return chrome.identity.getRedirectURL("supabase");
}

function parseOAuthRedirect(redirectUrl: string): URLSearchParams {
  const url = new URL(redirectUrl);
  // Supabase returns tokens in the fragment (implicit) or a code in the query (PKCE).
  const params = new URLSearchParams(url.search);
  if (url.hash.length > 1) {
    for (const [key, value] of new URLSearchParams(url.hash.slice(1))) {
      params.set(key, value);
    }
  }
  return params;
}

async function exchangePkceCode(code: string, verifier: string): Promise<AuthSession> {
  const response = await authEndpoint("/auth/v1/token?grant_type=pkce", {
    method: "POST",
    body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const session = toSession((await response.json()) as SupabaseTokenResponse);
  if (!session.accessToken) throw new Error("Google sign-in did not return a session.");
  await persist(session);
  notify(session);
  return session;
}

/**
 * Sign in with Google using Supabase OAuth via the Chrome extension flow.
 * Must be called with a transient user gesture (button click).
 *
 * Concurrent calls share one flow: Chrome allows only one web auth flow at a
 * time, so a second launch would otherwise fail spuriously.
 */
let googleFlow: Promise<AuthSession> | null = null;

export class SignInCancelledError extends Error {
  constructor() {
    super("Sign-in was cancelled.");
    this.name = "SignInCancelledError";
  }
}

export function signInWithGoogle(): Promise<AuthSession> {
  if (googleFlow) return googleFlow;
  googleFlow = runGoogleSignIn().finally(() => {
    googleFlow = null;
  });
  return googleFlow;
}

async function runGoogleSignIn(): Promise<AuthSession> {
  if (!authConfigured) throw new Error("Google sign-in is not configured for this build.");
  if (typeof chrome === "undefined" || !chrome.identity?.launchWebAuthFlow) {
    throw new Error("Google sign-in is not available in this environment.");
  }

  const redirectUri = getOAuthRedirectUrl();
  const verifier = randomVerifier();
  const challenge = await pkceChallenge(verifier);
  const authorizeUrl = new URL(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/authorize`);
  authorizeUrl.searchParams.set("provider", "google");
  authorizeUrl.searchParams.set("redirect_to", redirectUri);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  console.log("[yair] google oauth redirect URL (must be allow-listed in Supabase):", redirectUri);

  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({
      url: authorizeUrl.toString(),
      interactive: true,
    });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    // User closed the window, or another flow is still finishing: not an error.
    if (/cancel|only one web auth flow|user (denied|closed)|did not approve/i.test(message)) {
      throw new SignInCancelledError();
    }
    if (/authorization page could not be loaded/i.test(message)) {
      console.warn(
        "[yair] OAuth page failed to load. Add this redirect URL in Supabase → " +
          "Authentication → URL Configuration → Redirect URLs:",
        redirectUri,
      );
      throw new Error("Google sign-in couldn't be completed. Please try again in a moment.");
    }
    throw new Error(message);
  }
  if (!responseUrl) throw new SignInCancelledError();

  const params = parseOAuthRedirect(responseUrl);
  const oauthError = params.get("error_description") || params.get("error");
  if (oauthError) throw new Error(oauthError);

  const fragmentToken = params.get("access_token");
  if (fragmentToken) {
    const session = toSession({
      access_token: fragmentToken,
      refresh_token: params.get("refresh_token") ?? undefined,
      expires_in: Number(params.get("expires_in") ?? 3600),
      user: undefined,
    });
    // The fragment does not carry the profile; fetch it so the UI can show name/email.
    const profile = await fetchUser(session.accessToken).catch(() => null);
    if (profile) session.user = profile;
    await persist(session);
    notify(session);
    return session;
  }

  const code = params.get("code");
  if (code) return exchangePkceCode(code, verifier);
  throw new Error("Google sign-in did not return a session.");
}

async function fetchUser(accessToken: string): Promise<AuthUser | null> {
  const response = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return toAuthUser((await response.json()) as SupabaseUser);
}
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
