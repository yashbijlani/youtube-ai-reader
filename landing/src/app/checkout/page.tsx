"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hosted Razorpay checkout, served from the approved marketing domain so the
 * payment origin always matches the website registered with Razorpay.
 *
 * The extension opens `/checkout?order_id=<id>&api=<backend>`. We never assert
 * identity here: the backend activates the subscription from the order's
 * server-created notes, keyed off Razorpay's own order/payment status.
 */

type Phase = "preparing" | "opening" | "verifying" | "success" | "failed";

const DEFAULT_API = "https://youtube-ai-reader.onrender.com";

interface Order {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
  plan_name: string;
  status?: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export default function CheckoutPage() {
  const [phase, setPhase] = useState<Phase>("preparing");
  const [detail, setDetail] = useState("");
  const settled = useRef(false);

  const loadCheckoutScript = useCallback((): Promise<boolean> => {
    if (window.Razorpay) return Promise.resolve(true);
    return new Promise((resolve) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[src="https://checkout.razorpay.com/v1/checkout.js"]',
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(true));
        existing.addEventListener("error", () => resolve(false));
        return;
      }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order_id") ?? "";
    const api = (params.get("api") ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API).replace(/\/+$/, "");

    let cancelled = false;
    const succeed = () => {
      if (settled.current) return;
      settled.current = true;
      setPhase("success");
    };
    const fail = (message: string) => {
      if (settled.current) return;
      settled.current = true;
      setPhase("failed");
      setDetail(message);
    };

    const reconcile = async () => {
      try {
        const res = await fetch(`${api}/api/billing/reconcile/${encodeURIComponent(orderId)}`, {
          method: "POST",
        });
        return res.ok;
      } catch {
        return false;
      }
    };

    const poll = async () => {
      for (let i = 0; i < 120 && !settled.current; i += 1) {
        await new Promise((r) => setTimeout(r, 3000));
        if (settled.current) return;
        try {
          const res = await fetch(`${api}/api/billing/order/${encodeURIComponent(orderId)}`);
          if (!res.ok) continue;
          const order = (await res.json()) as Order;
          if (order.status === "paid") {
            await reconcile();
            succeed();
            return;
          }
        } catch {
          /* keep polling */
        }
      }
    };

    void (async () => {
      if (!orderId) return fail("Missing order reference.");
      let order: Order;
      try {
        const res = await fetch(`${api}/api/billing/order/${encodeURIComponent(orderId)}`);
        if (!res.ok) return fail("This order could not be loaded.");
        order = (await res.json()) as Order;
      } catch {
        return fail("Could not reach the payment server.");
      }
      if (cancelled) return;
      if (order.status === "paid") {
        await reconcile();
        return succeed();
      }

      setPhase("opening");
      const ready = await loadCheckoutScript();
      if (cancelled) return;
      if (!ready || !window.Razorpay) return fail("Could not load Razorpay Checkout.");

      const rzp = new window.Razorpay({
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "YouTube AI Reader",
        description: order.plan_name,
        theme: { color: "#cc0000" },
        handler: async (response: Record<string, string>) => {
          setPhase("verifying");
          try {
            const res = await fetch(`${api}/api/billing/verify-public`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            if (res.ok) return succeed();
          } catch {
            /* fall through to reconcile */
          }
          if (await reconcile()) return succeed();
          fail("We could not verify the payment.");
        },
        modal: {
          ondismiss: () => {
            if (!settled.current) setPhase("verifying");
          },
        },
      });
      rzp.open();
      void poll();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCheckoutScript]);

  return (
    <main className="grid min-h-screen place-items-center bg-ink-950 px-6 text-center text-white">
      <div className="max-w-sm">
        {phase === "preparing" || phase === "opening" ? (
          <>
            <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-[3px] border-white/25 border-t-accent" />
            <p>Preparing secure checkout…</p>
          </>
        ) : null}
        {phase === "verifying" ? (
          <>
            <div className="mx-auto mb-4 h-7 w-7 animate-spin rounded-full border-[3px] border-white/25 border-t-accent" />
            <p>Confirming your payment…</p>
            <p className="mt-2 text-[13px] text-ink-400">
              If you completed the payment, this will finish automatically.
            </p>
          </>
        ) : null}
        {phase === "success" ? (
          <>
            <h1 className="text-xl font-semibold text-emerald-400">Payment successful</h1>
            <p className="mt-2 text-ink-200">
              You&apos;re on Pro. Close this tab and return to YouTube.
            </p>
          </>
        ) : null}
        {phase === "failed" ? (
          <>
            <h1 className="text-xl font-semibold text-red-400">Payment failed</h1>
            <p className="mt-2 text-ink-200">{detail}</p>
            <p className="mt-3 text-[13px] text-ink-400">
              No money is kept on a failed payment. Any amount debited is refunded by your bank
              within 5–7 working days. You can try again from the extension.
            </p>
          </>
        ) : null}
      </div>
    </main>
  );
}
