import { describe, expect, test } from "bun:test";
import { readyCreatedAffirmation } from "../webview/src/lib/pendingCreation";

describe("created affirmation readiness", () => {
  const tracks = [
    { id: "older", offlineReady: true },
    { id: "created", offlineReady: false },
  ];

  test("waits for the matching affirmation's audio cache", () => {
    expect(readyCreatedAffirmation(tracks, "created")).toBeNull();
    expect(
      readyCreatedAffirmation(
        tracks.map((track) =>
          track.id === "created" ? { ...track, offlineReady: true } : track,
        ),
        "created",
      ),
    ).toEqual({ id: "created", offlineReady: true });
  });

  test("never selects a different ready affirmation", () => {
    expect(readyCreatedAffirmation(tracks, "missing")).toBeNull();
    expect(readyCreatedAffirmation(tracks, null)).toBeNull();
  });
});
