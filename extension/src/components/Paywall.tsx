import { SparkleIcon } from "./Icons";

interface PaywallProps {
  used: number;
  limit: number;
  onUpgrade: () => void;
  onSwitchAccount: () => void;
  onDismiss: () => void;
  upgradeError?: string | null;
}

export function Paywall({
  used,
  limit,
  onUpgrade,
  onSwitchAccount,
  onDismiss,
  upgradeError,
}: PaywallProps) {
  return (
    <div className="center-state">
      <span className="state-icon">
        <SparkleIcon size={20} />
      </span>
      <h3>You&apos;ve used your {limit} free videos this month</h3>
      <p>
        Upgrade to Pro for 50 videos a month, videos up to 3 hours, the full reading guide, chapters
        and grounded chat.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 280 }}>
        <button type="button" className="button primary" onClick={onUpgrade}>
          Upgrade to Pro
        </button>
        <button type="button" className="button secondary" onClick={onSwitchAccount}>
          Sign in with another account
        </button>
      </div>
      {upgradeError ? <div className="health-line bad">{upgradeError}</div> : null}
      <p className="muted small">
        {used}/{limit} videos used this month · cancel anytime
      </p>
      <button type="button" className="danger-button" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}
