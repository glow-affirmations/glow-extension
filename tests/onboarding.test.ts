import { describe, expect, test } from "bun:test";
import {
  ONBOARDING_COMPLETED_FOR_TESTING,
  resolveOnboardingCompleted,
} from "../webview/src/lib/onboarding";

describe("first-run onboarding", () => {
  test("does not ship with the development override enabled", () => {
    expect(ONBOARDING_COMPLETED_FOR_TESTING).toBeNull();
    expect(resolveOnboardingCompleted(true)).toBeTrue();
    expect(resolveOnboardingCompleted(false)).toBeFalse();
  });

  test("honors the persisted device-wide completion in production mode", () => {
    expect(resolveOnboardingCompleted(true, null)).toBeTrue();
    expect(resolveOnboardingCompleted(false, null)).toBeFalse();
    expect(resolveOnboardingCompleted(undefined, null)).toBeFalse();
  });

  test("allows a deliberate development override without changing persistence", () => {
    expect(resolveOnboardingCompleted(true, false)).toBeFalse();
    expect(resolveOnboardingCompleted(false, true)).toBeTrue();
  });
});
