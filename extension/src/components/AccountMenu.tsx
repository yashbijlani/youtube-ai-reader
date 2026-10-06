import { useEffect, useRef, useState } from "react";
import type { AuthController } from "../hooks/useAuth";
import { ChevronIcon } from "./Icons";

interface AccountMenuProps {
  auth: AuthController;
  plan: {
    paid: boolean;
    used: number;
    limit: number;
    remaining: number;
    onUpgrade: () => void;
  };
}

function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || "?").trim();
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

/** Header account chip + popover: identity, plan, usage, upgrade, sign out. */
export function AccountMenu({ auth, plan }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const user = auth.session?.user;
  const label = user ? user.name || user.email || "Account" : "Sign in";

  return (
    <div className="account" ref={rootRef}>
      <button
        type="button"
        className="account-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {user ? <span className="account-avatar">{initialsFor(user.name, user.email)}</span> : null}
        <span className="account-label">{label}</span>
        <ChevronIcon size={12} direction={open ? "up" : "down"} />
      </button>

      {open ? (
        <div className="account-popover" role="menu">
          {auth.loading ? (
            <p className="muted">Checking account…</p>
          ) : auth.session ? (
            <>
              <div className="account-name">{auth.session.user.name || auth.session.user.email}</div>
              {auth.session.user.email ? (
                <div className="muted small">{auth.session.user.email}</div>
              ) : null}
              <div className="account-plan">
                <span className={`badge${plan.paid ? " accent" : ""}`}>
                  {plan.paid ? "Pro" : "Free"}
                </span>
                <span className="muted small">
                  {plan.paid
                    ? "Unlimited videos"
                    : `${plan.remaining} of ${plan.limit} free videos remaining`}
                </span>
              </div>
              {!plan.paid ? (
                <button type="button" className="button primary" onClick={plan.onUpgrade}>
                  Upgrade to Pro
                </button>
              ) : null}
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  void auth.signOut();
                  setOpen(false);
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                Sign in with Google to generate guides, chat, and track your usage.
              </p>
              <button
                type="button"
                className="button primary"
                disabled={!auth.configured || googleBusy}
                onClick={async () => {
                  setGoogleBusy(true);
                  try {
                    await auth.signInWithGoogle();
                    setOpen(false);
                  } finally {
                    setGoogleBusy(false);
                  }
                }}
              >
                {googleBusy ? "Signing in…" : "Continue with Google"}
              </button>
              {!auth.configured ? (
                <div className="hint">Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</div>
              ) : null}
              {auth.error ? <div className="health-line bad">{auth.error}</div> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
