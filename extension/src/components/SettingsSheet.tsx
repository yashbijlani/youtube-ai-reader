import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { VideoInfo } from "../types";
import { CloseIcon } from "./Icons";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  apiBaseUrl: string;
  onSaveApiBaseUrl: (url: string) => Promise<void>;
  video: VideoInfo | null;
  hasConversation: boolean;
  onClearConversation: () => void;
  onClearAllConversations: () => void;
  plan: {
    paid: boolean;
    used: number;
    limit: number;
    remaining: number;
    onUpgrade: () => void;
    onManage: () => void;
    onTrial: () => void;
  };
}

export function SettingsSheet({
  open,
  onClose,
  apiBaseUrl,
  onSaveApiBaseUrl,
  video,
  hasConversation,
  onClearConversation,
  onClearAllConversations,
  plan,
}: SettingsSheetProps) {
  const [draftUrl, setDraftUrl] = useState(apiBaseUrl);
  const [health, setHealth] = useState<string>("");
  const [healthState, setHealthState] = useState<"idle" | "ok" | "bad" | "checking">("idle");
  const [cleared, setCleared] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const auth = useAuth();

  useEffect(() => {
    setDraftUrl(apiBaseUrl);
    setCleared(false);
    if (!open) return;
    void check(apiBaseUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, apiBaseUrl]);

  const check = async (url: string) => {
    setHealthState("checking");
    setHealth("");
    try {
      const info = await api.health(url);
      setHealthState("ok");
      setHealth(`Connected · model ${info.model}${info.ai_configured ? "" : " (no API key set)"}`);
    } catch (error) {
      setHealthState("bad");
      setHealth(error instanceof ApiError ? error.message : "Backend unreachable.");
    }
  };

  if (!open) return null;

  return (
    <div className="overlay" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="settings-sheet" role="dialog" aria-label="Settings">
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <h3 style={{ flex: 1 }}>Settings</h3>
          <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </div>
        <p className="muted">
          The extension talks to your own backend. API keys never leave the server.
        </p>

        <div className="field">
          <label htmlFor="api-base">Backend URL</label>
          <input
            id="api-base"
            value={draftUrl}
            spellCheck={false}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="http://127.0.0.1:8000"
          />
          <div className="hint">
            Development default is http://127.0.0.1:8000. Change it when deploying.
          </div>
        </div>
        <div className="settings-row">
          <button
            type="button"
            className="button primary"
            onClick={async () => {
              await onSaveApiBaseUrl(draftUrl.trim() || "http://127.0.0.1:8000");
              void check(draftUrl.trim() || "http://127.0.0.1:8000");
            }}
          >
            Save & test
          </button>
          <button type="button" className="button secondary" onClick={() => void check(draftUrl.trim() || "http://127.0.0.1:8000")}>
            Test connection
          </button>
        </div>
        <div
          className={`health-line${healthState === "ok" ? " ok" : healthState === "bad" ? " bad" : ""}`}
        >
          {healthState === "checking" ? "Checking…" : health}
        </div>

        <div className="divider" />

        <h3 style={{ fontSize: 13.5 }}>Plan</h3>
        <p className="muted">
          {plan.paid
            ? "Pro — unlimited videos."
            : `Free — ${plan.used}/${plan.limit} videos used (${plan.remaining} left).`}
        </p>
        <div className="settings-row" style={{ marginTop: 8 }}>
          {plan.paid ? (
            <button type="button" className="button secondary" onClick={plan.onManage}>
              Manage subscription
            </button>
          ) : (
            <>
              <button type="button" className="button primary" onClick={plan.onUpgrade}>
                Upgrade to Pro
              </button>
              <button type="button" className="button secondary" onClick={plan.onTrial}>
                Free trial
              </button>
            </>
          )}
        </div>

        <div className="divider" />

        <h3 style={{ fontSize: 13.5 }}>Account</h3>
        {auth.loading ? (
          <p className="muted">Checking account…</p>
        ) : auth.session ? (
          <>
            <p className="muted">
              Signed in as <strong>{auth.session.user.email ?? auth.session.user.id.slice(0, 8)}</strong>
            </p>
            <div className="settings-row" style={{ marginTop: 8 }}>
              <button type="button" className="button secondary" onClick={() => void auth.signOut()}>
                Sign out
              </button>
            </div>
          </>
        ) : !auth.configured ? (
          <p className="muted">Sign-in is not configured in this build.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {auth.error ? <div className="health-line bad">{auth.error}</div> : null}
            {authNotice ? <div className="health-line ok">{authNotice}</div> : null}
            <div className="settings-row">
              <button
                type="button"
                className="button primary"
                disabled={!email || !password}
                onClick={async () => {
                  setAuthNotice("");
                  await auth.signIn(email, password);
                }}
              >
                Sign in
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={!email || password.length < 6}
                onClick={async () => {
                  setAuthNotice("");
                  const result = await auth.signUp(email, password);
                  if (result?.needsConfirmation) {
                    setAuthNotice("Check your email to confirm your account.");
                  }
                }}
              >
                Create account
              </button>
            </div>
            <div className="hint">Signing in enables server-side quotas and Pro billing.</div>
          </>
        )}

        <div className="divider" />
        <h3 style={{ fontSize: 13.5 }}>Conversations</h3>
        <p className="muted">Chat history is stored locally in your browser, per video.</p>
        <div className="settings-row" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="button secondary"
            disabled={!video || !hasConversation}
            onClick={() => {
              onClearConversation();
              setCleared(true);
            }}
          >
            Clear this video's chat
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              onClearAllConversations();
              setCleared(true);
            }}
          >
            Clear all chats
          </button>
        </div>
        {cleared ? <div className="health-line ok">Cleared.</div> : null}

        <div className="divider" />
        <p className="muted small">
          YouTube AI Reader v0.1.0 · Open the extension on a YouTube watch page and click
          “✨ Read with AI”. Processing requires the backend to be running.
        </p>
      </div>
    </div>
  );
}
