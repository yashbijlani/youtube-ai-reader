"""Hosted Razorpay checkout page.

Manifest V3 forbids loading remote scripts inside extension pages, so the
extension opens this page in a normal tab instead. It loads Razorpay Checkout,
and on success calls the public verification endpoint. The user id is taken from
the order's server-created notes — the page never asserts identity.
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
  .card { text-align: center; padding: 32px; max-width: 380px; }
  .spinner { width: 28px; height: 28px; border: 3px solid #444; border-top-color: #ff6b6b;
             border-radius: 50%; animation: s 0.8s linear infinite; margin: 0 auto 16px; }
  @keyframes s { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="card">
  <div id="root"><div class="spinner"></div><div>Preparing secure checkout…</div></div>
</div>
<script>
  const orderId = new URLSearchParams(location.search).get("order_id");
  const root = document.getElementById("root");
  function fail(msg) { root.innerHTML = "<h2>Checkout unavailable</h2><p>" + msg + "</p>"; }

  async function main() {
    if (!orderId) return fail("Missing order reference.");
    let order;
    try {
      const res = await fetch("/api/billing/order/" + encodeURIComponent(orderId));
      if (!res.ok) return fail("This order could not be loaded.");
      order = await res.json();
    } catch (e) { return fail("Could not reach the payment server."); }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => openCheckout(order);
    script.onerror = () => fail("Could not load Razorpay Checkout.");
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
        root.innerHTML = "<div class='spinner'></div><div>Verifying payment…</div>";
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
          root.innerHTML = res.ok
            ? "<h2>Payment successful</h2><p>You can close this tab and return to YouTube.</p>"
            : "<h2>Verification failed</h2><p>Please contact support.</p>";
        } catch (e) {
          root.innerHTML = "<h2>Verification failed</h2><p>Please contact support.</p>";
        }
      },
      modal: { ondismiss: () => { root.innerHTML = "<h2>Checkout closed</h2><p>No payment was taken. You can close this tab.</p>"; } },
    });
    rzp.open();
  }

  main();
</script>
</body>
</html>
"""


def checkout_html() -> str:
    """The order id is read from the query string by the page itself."""
    return _PAGE
