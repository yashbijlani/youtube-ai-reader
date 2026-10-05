import ExtPay from "extpay";

/**
 * ExtensionPay integration. Register the extension at https://extensionpay.com
 * with the same id (VITE_EXTPAY_ID) and connect Stripe there.
 *
 * `startBackground()` must be called once from the background service worker;
 * the side panel uses `getUser()` / `openPaymentPage()`.
 */
export const EXTPAY_ID =
  (import.meta.env?.VITE_EXTPAY_ID as string | undefined) || "youtube-ai-reader";

export const extpay = ExtPay(EXTPAY_ID);

export interface Entitlement {
  paid: boolean;
  email: string | null;
  status: "active" | "past_due" | "canceled" | null;
}

export async function getExtPayEntitlement(): Promise<Entitlement> {
  try {
    const user = await extpay.getUser();
    return {
      paid: Boolean(user.paid),
      email: user.email ?? null,
      status: (user.subscriptionStatus as Entitlement["status"]) ?? null,
    };
  } catch (error) {
    console.warn("[yair] ExtPay getUser failed", error);
    return { paid: false, email: null, status: null };
  }
}
