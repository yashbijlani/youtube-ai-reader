import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { onAuthChange } from "../lib/auth";
import { openHostedCheckout } from "../lib/billing";
import type { AccountInfo, UsageInfo } from "../types";

export interface EntitlementController {
  paid: boolean;
  used: number;
  limit: number;
  remaining: number;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  openPayment: () => void;
  openTrial: () => void;
  manage: () => void;
}

const FREE_DEFAULT: UsageInfo = { used: 0, limit: 3, paid: false, remaining: 3 };

/**
 * Entitlement is authoritative on the backend (`GET /me`). Upgrades go through
 * a server-created Razorpay order and server-side signature verification.
 */
export function useEntitlement(apiBaseUrl: string): EntitlementController {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await api.me(apiBaseUrl);
      setAccount(info);
      setError(null);
    } catch {
      // Account info is unavailable (offline); keep last known state.
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch authoritative account state whenever the auth session changes.
  useEffect(() => onAuthChange(() => void refresh()), [refresh]);

  const startCheckout = useCallback(async () => {
    setError(null);
    try {
      const order = await api.createOrder(apiBaseUrl);
      const opened = await openHostedCheckout(apiBaseUrl, order);
      if (!opened) {
        setError("Could not open the checkout page.");
        return;
      }
      // The hosted page verifies and activates server-side; poll until it lands.
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const info = await api.me(apiBaseUrl).catch(() => null);
        if (info) {
          setAccount(info);
          if (info.subscription?.active) break;
        }
      }
    } catch (err) {
      setError((err as Error).message || "Could not start checkout.");
    }
  }, [apiBaseUrl]);

  const usage: UsageInfo = account
    ? {
        used: account.usage.lifetime_videos,
        limit: account.usage.free_limit,
        paid: account.subscription?.active ?? false,
        remaining: Math.max(account.usage.free_limit - account.usage.lifetime_videos, 0),
      }
    : FREE_DEFAULT;

  return {
    paid: usage.paid,
    used: usage.used,
    limit: usage.limit,
    remaining: usage.remaining,
    loading,
    error,
    refresh,
    openPayment: () => void startCheckout(),
    // No separate trial anymore; the button opens the same checkout.
    openTrial: () => void startCheckout(),
    manage: () => void startCheckout(),
  };
}
