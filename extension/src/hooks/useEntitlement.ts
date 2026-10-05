import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { extpay, getExtPayEntitlement } from "../lib/entitlement";
import type { UsageInfo } from "../types";

export interface EntitlementController {
  paid: boolean;
  used: number;
  limit: number;
  remaining: number;
  loading: boolean;
  refresh: () => Promise<void>;
  openPayment: () => void;
  openTrial: () => void;
  manage: () => void;
}

export function useEntitlement(apiBaseUrl: string): EntitlementController {
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const entitlement = await getExtPayEntitlement();
      if (entitlement.paid) {
        await api
          .setEntitlement(apiBaseUrl, true, entitlement.email)
          .catch(() => undefined);
      }
      const info = await api.usage(apiBaseUrl);
      setUsage(info);
    } catch {
      // Usage endpoint may be unreachable; keep defaults.
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    try {
      extpay.onPaid.addListener(() => void refresh());
    } catch {
      // ExtPay not configured yet.
    }
  }, [refresh]);

  return {
    paid: usage?.paid ?? false,
    used: usage?.used ?? 0,
    limit: usage?.limit ?? 3,
    remaining: usage?.remaining ?? 3,
    loading,
    refresh,
    openPayment: () => void extpay.openPaymentPage().catch(() => undefined),
    openTrial: () => void extpay.openTrialPage().catch(() => undefined),
    manage: () => void extpay.openPaymentPage().catch(() => undefined),
  };
}
