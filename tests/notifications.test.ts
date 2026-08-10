import { describe, expect, test } from "bun:test";
import { libraryNoticeTone, notificationDurationMs } from "../webview/src/lib/notifications";

describe("notification conventions", () => {
  test("classifies connectivity and background sync notices", () => {
    expect(libraryNoticeTone("Offline — showing saved affirmations.")).toBe("warning");
    expect(libraryNoticeTone("Saved locally — waiting to sync.")).toBe("warning");
    expect(libraryNoticeTone("Back online — everything is synced.")).toBe("success");
    expect(libraryNoticeTone("Complete sign in in your browser.")).toBe("info");
  });

  test("keeps important tones visible longer than success feedback", () => {
    expect(notificationDurationMs("success")).toBeLessThan(notificationDurationMs("warning"));
    expect(notificationDurationMs("warning")).toBeLessThan(notificationDurationMs("error"));
  });
});
