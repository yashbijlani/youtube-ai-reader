import { beforeEach, describe, expect, it, vi } from "vitest";
import { openHostedCheckout } from "../src/lib/billing";

const create = vi.fn(async () => ({ id: 1 }));
(globalThis as unknown as { chrome: unknown }).chrome = { tabs: { create } };

describe("openHostedCheckout", () => {
  beforeEach(() => create.mockClear());

  it("opens the hosted checkout page on the marketing domain with the order id", async () => {
    const ok = await openHostedCheckout("http://127.0.0.1:8000/", {
      order_id: "order_abc123",
      amount: 29900,
      currency: "INR",
      key_id: "rzp_test_x",
      plan_name: "Pro",
    });
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const call = create.mock.calls[0] as unknown as [{ url: string }];
    expect(call[0].url).toBe(
      "https://youtube-ai-reader-mt4h.vercel.app/checkout?order_id=order_abc123&api=http%3A%2F%2F127.0.0.1%3A8000",
    );
  });
});
