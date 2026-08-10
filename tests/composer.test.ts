import { describe, expect, test } from "bun:test";
import { shouldAutoOpenComposer } from "../webview/src/lib/composer";

const eligible = {
  userId: "user-1",
  handledUserId: null,
  entitlement: "premium" as const,
  syncStatus: "online" as const,
  customAffirmationCount: 0,
};

describe("new Premium affirmation composer", () => {
  test("opens for a resolved empty Premium library", () => {
    expect(shouldAutoOpenComposer(eligible)).toBeTrue();
  });

  test("waits for the authenticated library to finish syncing", () => {
    expect(
      shouldAutoOpenComposer({ ...eligible, syncStatus: "refreshing" }),
    ).toBeFalse();
  });

  test("does not open for Free, existing, or already handled libraries", () => {
    expect(
      shouldAutoOpenComposer({ ...eligible, entitlement: "free" }),
    ).toBeFalse();
    expect(
      shouldAutoOpenComposer({ ...eligible, customAffirmationCount: 1 }),
    ).toBeFalse();
    expect(
      shouldAutoOpenComposer({ ...eligible, handledUserId: "user-1" }),
    ).toBeFalse();
  });
});
