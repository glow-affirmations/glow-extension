import { describe, expect, test } from "bun:test";
import {
  entitlementAfterBackgroundCheck,
  migrateCachedGlowEntitlement,
  premiumFeatureMessage,
  resolveGlowEntitlement,
} from "../src/entitlement";

describe("Glow extension entitlement", () => {
  test("treats a missing billing row as Free", () => {
    expect(resolveGlowEntitlement(null, false)).toBe("free");
  });

  test("accepts only a server-derived eligible entitlement as Premium", () => {
    expect(resolveGlowEntitlement({ is_entitled: true }, false)).toBe(
      "premium",
    );
    expect(resolveGlowEntitlement({ is_entitled: false }, false)).toBe("free");
    expect(resolveGlowEntitlement({ is_entitled: "true" }, false)).toBe("free");
  });

  test("fails closed when billing state cannot be read", () => {
    expect(resolveGlowEntitlement({ is_entitled: true }, true)).toBe(
      "unavailable",
    );
    expect(premiumFeatureMessage("unavailable")).toContain(
      "could not confirm",
    );
  });

  test("keeps the last confirmed plan while it revalidates in the background", () => {
    expect(entitlementAfterBackgroundCheck("unavailable", "premium")).toBe(
      "premium",
    );
    expect(entitlementAfterBackgroundCheck("unavailable", "free")).toBe(
      "free",
    );
    expect(entitlementAfterBackgroundCheck("premium", "free")).toBe(
      "premium",
    );
    expect(entitlementAfterBackgroundCheck("free", "premium")).toBe("free");
  });

  test("migrates old caches without showing an intermediate plan screen", () => {
    expect(migrateCachedGlowEntitlement(undefined, false)).toBe("free");
    expect(migrateCachedGlowEntitlement(undefined, true)).toBe("premium");
    expect(migrateCachedGlowEntitlement("premium", false)).toBe("premium");
  });
});
