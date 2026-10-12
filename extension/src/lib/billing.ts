/**
 * Razorpay billing for the extension.
 *
 * Manifest V3 forbids loading Razorpay's remote checkout script inside
 * extension pages, so we open the backend's hosted checkout page in a browser
 * tab. The backend verifies the payment signature and activates the
 * subscription server-side; the extension just refreshes `/me` afterwards.
 */

export interface RazorpayOrder {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  plan_name: string;
}

/**
 * Where the hosted checkout page is served. Defaults to the marketing site so
 * the payment origin matches the website registered with Razorpay (a mismatch
 * makes Razorpay block payments at initiation).
 */
const CHECKOUT_BASE_URL: string =
  (import.meta.env?.VITE_CHECKOUT_BASE_URL as string | undefined) ??
  "https://youtube-ai-reader-mt4h.vercel.app";

/** Open the hosted checkout page for an order in a new tab. */
export async function openHostedCheckout(
  apiBaseUrl: string,
  order: RazorpayOrder,
): Promise<boolean> {
  const base = (apiBaseUrl || "").replace(/\/+$/, "");
  const checkoutBase = CHECKOUT_BASE_URL.replace(/\/+$/, "");
  const url =
    `${checkoutBase}/checkout?order_id=${encodeURIComponent(order.order_id)}` +
    `&api=${encodeURIComponent(base)}`;
  try {
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      await chrome.tabs.create({ url });
      return true;
    }
    window.open(url, "_blank", "noopener");
    return true;
  } catch {
    return false;
  }
}
