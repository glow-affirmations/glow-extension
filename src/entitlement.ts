export type GlowEntitlement =
  | "signed_out"
  | "free"
  | "premium"
  | "unavailable";

export type KnownGlowEntitlement = "free" | "premium";

export function resolveGlowEntitlement(
  row: unknown,
  queryFailed: boolean,
): GlowEntitlement {
  if (queryFailed) return "unavailable";
  if (!isRecord(row)) return "free";
  return row.is_entitled === true ? "premium" : "free";
}

export function isKnownGlowEntitlement(
  entitlement: unknown,
): entitlement is KnownGlowEntitlement {
  return entitlement === "free" || entitlement === "premium";
}

export function migrateCachedGlowEntitlement(
  entitlement: unknown,
  hasCustomAffirmations: boolean,
): KnownGlowEntitlement {
  if (isKnownGlowEntitlement(entitlement)) return entitlement;
  return hasCustomAffirmations ? "premium" : "free";
}

export function entitlementAfterBackgroundCheck(
  refreshed: GlowEntitlement,
  cached: KnownGlowEntitlement | null,
): KnownGlowEntitlement {
  return isKnownGlowEntitlement(refreshed) ? refreshed : (cached ?? "free");
}

export function premiumFeatureMessage(entitlement: GlowEntitlement): string {
  if (entitlement === "free") {
    return "Custom affirmations are included with Glow Premium.";
  }
  return "Glow could not confirm your plan. Refresh after reconnecting and try again.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
