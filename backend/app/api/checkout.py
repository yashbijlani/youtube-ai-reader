"""Hosted Razorpay checkout page.

Manifest V3 forbids loading remote scripts inside extension pages, so the
extension opens this page in a normal tab instead. It loads Razorpay Checkout,
and on success calls the public verification endpoint. The user id is taken from
the order's server-created notes — the page never asserts identity.

The payment is also reconciled server-side: the page polls the order status and
activates via `/api/billing/reconcile/{order_id}` when Razorpay reports the order
as paid, so a missed browser callback can never leave a paid order inactive.
"""

from __future__ import annotations

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>YouTube AI Reader — Checkout</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; display: grid;
         place-items: center; min-height: 100vh; background: #0f0f0f; color: #f1f1f1; }
  .card { text-align: center; padding: 32px; max-width: 400px; }
  .spinner { width: 28px; height: 28px; border: 3px solid #444; border-top-color: #ff6b6b;
             border-radius: 50%; animation: s 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes s { to { transform: rotate(360deg); } }
  .ok { color: #4ade80; } .bad { color: #f87171; }
  .muted { color: #9ca3af; font-size: 13px; }
  button { margin-top: 16px; background: #ff0000; color: #fff; border: 0; border-radius: 8px;
           padding: 10px 18px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
  <div id="root"><div class="spinner"></div><div>Preparing secure checkout…</div></div>
</div>
<script>
  const orderId = new URLSearchParams(location.search).get("order_id");
  const root = document.getElementById("root");
  let settled = false;

  function render(html) { root.innerHTML = html; }
  function succeeded() {
    settled = true;
    render("<h2 class='ok'>Payment successful</h2>" +
      "<p>You're on Pro. You can close this tab and return to YouTube.</p>" +
      "<button onclick='window.close()'>Close</button>");
    setTimeout(() => window.close(), 1800);
  }
  function failed(msg) {
    settled = true;
    render("<h2 class='bad'>Payment failed</h2><p>" + msg + "</p>" +
      "<p class='muted'>No money is kept on a failed payment. Any amount debited is " +
      "refunded by your bank within 5–7 working days. You can try again from the extension.</p>");
  }

  async function reconcile() {
    try {
      const res = await fetch("/api/billing/reconcile/" + encodeURIComponent(orderId), { method: "POST" });
      return res.ok;
    } catch (e) { return false; }
  }

  async function pollUntilSettled() {
    // Ask Razorpay (via our server) whether the order is actually paid. This is
    // the safety net for UPI flows where the browser callback never fires.
    for (let i = 0; i < 120 && !settled; i += 1) {
      await new Promise((r) => setTimeout(r, 3000));
      if (settled) return;
      let order;
      try {
        const res = await fetch("/api/billing/order/" + encodeURIComponent(orderId));
        if (!res.ok) continue;
        order = await res.json();
      } catch (e) { continue; }
      if (order.status === "paid") { await reconcile(); succeeded(); return; }
    }
  }

  async function main() {
    if (!orderId) return failed("Missing order reference.");
    let order;
    try {
      const res = await fetch("/api/billing/order/" + encodeURIComponent(orderId));
      if (!res.ok) return failed("This order could not be loaded.");
      order = await res.json();
      if (order.status === "paid") { await reconcile(); return succeeded(); }
    } catch (e) { return failed("Could not reach the payment server."); }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => openCheckout(order);
    script.onerror = () => failed("Could not load Razorpay Checkout.");
    document.head.appendChild(script);
  }

  function openCheckout(order) {
    const rzp = new Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: "YouTube AI Reader",
      description: order.plan_name,
      theme: { color: "#cc0000" },
      handler: async (response) => {
        render("<div class='spinner'></div><div>Verifying payment…</div>");
        try {
          const res = await fetch("/api/billing/verify-public", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          if (res.ok) return succeeded();
          if (await reconcile()) return succeeded();
          failed("We could not verify the payment.");
        } catch (e) {
          if (await reconcile()) return succeeded();
          failed("We could not verify the payment.");
        }
      },
      modal: {
        ondismiss: () => {
          if (!settled) render("<div class='spinner'></div><div>Confirming payment…</div>");
        },
      },
    });
    rzp.open();
    pollUntilSettled();
  }

  main();
</script>
</body>
</html>
"""


def checkout_html() -> str:
    """The order id is read from the query string by the page itself."""
    return _PAGE
