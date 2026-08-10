import { describe, expect, test } from "bun:test";
import {
  PREMIUM_CHECKOUT_POLL_ATTEMPTS,
  PREMIUM_CHECKOUT_POLL_DURATION_MS,
  PREMIUM_CHECKOUT_POLL_INTERVAL_MS,
  PremiumCheckoutError,
  requestPremiumCheckout,
  SIGNED_OUT_PREMIUM_CHECKOUT_URL,
  shouldContinuePremiumCheckoutPolling,
} from "../src/premiumCheckout";

function response(status: number, body: unknown): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
}

describe("Glow Premium checkout", () => {
  test("starts signed-out checkout on the first-party purchase bridge", () => {
    expect(SIGNED_OUT_PREMIUM_CHECKOUT_URL).toBe(
      "https://justglow.dev/checkout/extension-offer",
    );
  });

  test("accepts a short-lived Polar checkout URL", async () => {
    await expect(
      requestPremiumCheckout(
        response(201, {
          checkoutUrl: "https://sandbox.polar.sh/checkout/example",
        }),
        "access-token",
      ),
    ).resolves.toBe("https://sandbox.polar.sh/checkout/example");
  });

  test("rejects a checkout URL outside Polar", async () => {
    await expect(
      requestPremiumCheckout(
        response(201, { checkoutUrl: "https://example.com/checkout" }),
        "access-token",
      ),
    ).rejects.toMatchObject({ kind: "service" });
  });

  test("surfaces an expired extension session for one refresh attempt", async () => {
    await expect(
      requestPremiumCheckout(
        response(401, { error: "unauthorized" }),
        "access-token",
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<PremiumCheckoutError>>({
        kind: "authentication",
      }),
    );
  });

  test("does not create another checkout for an active Premium account", async () => {
    await expect(
      requestPremiumCheckout(
        response(409, { error: "already_premium" }),
        "access-token",
      ),
    ).rejects.toMatchObject({ kind: "already_premium" });
  });

  test("polls every ten seconds for a complete nine-minute window", () => {
    expect(PREMIUM_CHECKOUT_POLL_INTERVAL_MS).toBe(10_000);
    expect(PREMIUM_CHECKOUT_POLL_DURATION_MS).toBe(9 * 60 * 1_000);
    expect(
      PREMIUM_CHECKOUT_POLL_ATTEMPTS * PREMIUM_CHECKOUT_POLL_INTERVAL_MS,
    ).toBe(PREMIUM_CHECKOUT_POLL_DURATION_MS);
    expect(shouldContinuePremiumCheckoutPolling(0)).toBe(true);
    expect(
      shouldContinuePremiumCheckoutPolling(
        PREMIUM_CHECKOUT_POLL_ATTEMPTS - 1,
      ),
    ).toBe(true);
    expect(
      shouldContinuePremiumCheckoutPolling(PREMIUM_CHECKOUT_POLL_ATTEMPTS),
    ).toBe(false);
  });
});
