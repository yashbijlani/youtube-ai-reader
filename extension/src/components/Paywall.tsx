import { SparkleIcon } from "./Icons";

interface PaywallProps {
  used: number;
  limit: number;
  onUpgrade: () => void;
  onTrial: () => void;
  onManage: () => void;
  onDismiss: () => void;
}

export function Paywall({ used, limit, onUpgrade, onTrial, onManage, onDismiss }: PaywallProps) {
  return (
    <div className="center-state">
      <span className="state-icon">
        <SparkleIcon size={20} />
      </span>
      <h3>You've used your {limit} free videos</h3>
      <p>
        Upgrade to Pro for unlimited videos, the full reading guide, chapters, and grounded chat.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 280 }}>
        <button type="button" className="button primary" onClick={onUpgrade}>
          Upgrade to Pro
        </button>
        <button type="button" className="button secondary" onClick={onTrial}>
          Start 7-day free trial
        </button>
        <button type="button" className="button secondary" onClick={onManage}>
          Already subscribed? Sign in
        </button>
      </div>
      <p className="muted small">
        {used}/{limit} free videos used · cancel anytime
      </p>
      <button type="button" className="danger-button" onClick={onDismiss}>
        Not now
      </button>
    </div>
  );
}
