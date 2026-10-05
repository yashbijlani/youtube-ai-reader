import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { openRazorpayCheckout } from "../lib/billing";
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

  const startCheckout = useCallback(async () => {
    setError(null);
    try {
      const order = await api.createOrder(apiBaseUrl);
      await openRazorpayCheckout(
        order,
        { email: account?.user?.email ?? null },
        {
          onSuccess: async (response) => {
            try {
              await api.verifyPayment(apiBaseUrl, response);
              await refresh();
            } catch {
              setError("Payment received, but activation failed. Please contact support.");
            }
          },
          onDismiss: () => undefined,
        },
      );
    } catch (err) {
      setError((err as Error).message || "Could not start checkout.");
    }
  }, [account?.user?.email, apiBaseUrl, refresh]);

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
