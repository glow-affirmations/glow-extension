import type { FetchLike } from "./network.js";

export const PREMIUM_CHECKOUT_ENDPOINT =
  "https://justglow.dev/api/extension-checkout";
export const SIGNED_OUT_PREMIUM_CHECKOUT_URL =
  "https://justglow.dev/checkout/extension-offer";
export const PREMIUM_CHECKOUT_POLL_INTERVAL_MS = 10_000;
export const PREMIUM_CHECKOUT_POLL_DURATION_MS = 9 * 60 * 1_000;
export const PREMIUM_CHECKOUT_POLL_ATTEMPTS =
  PREMIUM_CHECKOUT_POLL_DURATION_MS / PREMIUM_CHECKOUT_POLL_INTERVAL_MS;

export function shouldContinuePremiumCheckoutPolling(
  completedAttempts: number,
): boolean {
  return (
    Number.isInteger(completedAttempts) &&
    completedAttempts >= 0 &&
    completedAttempts < PREMIUM_CHECKOUT_POLL_ATTEMPTS
  );
}

export type PremiumCheckoutFailureKind =
  "authentication" | "already_premium" | "service";

export class PremiumCheckoutError extends Error {
  constructor(
    public readonly kind: PremiumCheckoutFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "PremiumCheckoutError";
  }
}

function isPolarCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "polar.sh" || url.hostname.endsWith(".polar.sh"))
    );
  } catch {
    return false;
  }
}

export async function requestPremiumCheckout(
  fetchImpl: FetchLike,
  accessToken: string,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(PREMIUM_CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    throw new PremiumCheckoutError(
      "service",
      "Glow could not reach secure checkout. Check your connection and try again.",
    );
  }

  if (response.status === 401) {
    throw new PremiumCheckoutError(
      "authentication",
      "Your Glow session needs to be refreshed.",
    );
  }
  if (response.status === 409) {
    throw new PremiumCheckoutError(
      "already_premium",
      "Glow Premium is already active for this account.",
    );
  }
  if (response.status !== 201) {
    throw new PremiumCheckoutError(
      "service",
      "Secure checkout is temporarily unavailable. Please try again shortly.",
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PremiumCheckoutError(
      "service",
      "Glow received an invalid checkout response.",
    );
  }

  const checkoutUrl =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    typeof (body as Record<string, unknown>).checkoutUrl === "string"
      ? (body as Record<string, string>).checkoutUrl
      : null;
  if (!checkoutUrl || !isPolarCheckoutUrl(checkoutUrl)) {
    throw new PremiumCheckoutError(
      "service",
      "Glow received an invalid checkout destination.",
    );
  }

  return checkoutUrl;
}
