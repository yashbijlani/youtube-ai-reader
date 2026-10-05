/**
 * Razorpay Checkout integration.
 *
 * The extension asks the backend for an order, opens Razorpay Checkout, and
 * sends the resulting payment signature back to the backend for verification.
 * The client never decides entitlement; the backend does.
 */

export interface RazorpayOrder {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  plan_name: string;
}

interface RazorpayHandlerResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open: () => void;
  on?: (event: string, handler: () => void) => void;
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance;
}

const CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<RazorpayConstructor> {
  return new Promise((resolve, reject) => {
    const existing = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_URL;
    script.async = true;
    script.onload = () => {
      const ctor = (window as unknown as { Razorpay?: RazorpayConstructor }).Razorpay;
      if (ctor) resolve(ctor);
      else reject(new Error("Razorpay Checkout failed to initialize."));
    };
    script.onerror = () =>
      reject(
        new Error(
          "Razorpay Checkout cannot run inside a Manifest V3 extension page. " +
            "Checkout must be completed on a hosted page.",
        ),
      );
    document.head.appendChild(script);
  });
}

export interface CheckoutCallbacks {
  onSuccess: (response: RazorpayHandlerResponse) => Promise<void> | void;
  onDismiss?: () => void;
}

export async function openRazorpayCheckout(
  order: RazorpayOrder,
  user: { email?: string | null },
  callbacks: CheckoutCallbacks,
): Promise<void> {
  const Razorpay = await loadCheckout();
  const instance = new Razorpay({
    key: order.key_id,
    amount: order.amount,
    currency: order.currency,
    name: "YouTube AI Reader",
    description: order.plan_name,
    order_id: order.order_id,
    prefill: user.email ? { email: user.email } : undefined,
    theme: { color: "#cc0000" },
    handler: (response: RazorpayHandlerResponse) => {
      void callbacks.onSuccess(response);
    },
    modal: {
      ondismiss: () => callbacks.onDismiss?.(),
    },
  });
  instance.open();
}
