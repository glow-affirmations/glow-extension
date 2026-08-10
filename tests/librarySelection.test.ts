import { describe, expect, test } from "bun:test";
import {
  adjacentTrackAfterRemoval,
  restoredPlayingTrack,
  restoredTrackId,
  selectedTrackOrFirst,
} from "../webview/src/lib/librarySelection";

describe("remembered library selections", () => {
  const tracks = [{ id: "first" }, { id: "remembered" }];

  test("restores a remembered track that is still available", () => {
    expect(selectedTrackOrFirst(tracks, "remembered")).toBe(tracks[1]);
  });

  test("falls back to the first track when the remembered one was removed", () => {
    expect(selectedTrackOrFirst(tracks, "deleted")).toBe(tracks[0]);
    expect(selectedTrackOrFirst([], "deleted")).toBeNull();
  });

  test("selects the next neighboring track after deleting the current track", () => {
    const ordered = [{ id: "before" }, { id: "deleted" }, { id: "after" }];

    expect(adjacentTrackAfterRemoval(ordered, "deleted")).toBe(ordered[2]);
  });

  test("selects the previous neighboring track when deleting the final track", () => {
    const ordered = [{ id: "before" }, { id: "deleted" }];

    expect(adjacentTrackAfterRemoval(ordered, "deleted")).toBe(ordered[0]);
  });

  test("skips unavailable neighboring tracks before leaving the collection", () => {
    const ordered = [
      { id: "available-before", available: true },
      { id: "deleted", available: true },
      { id: "unavailable-after", available: false },
    ];

    expect(
      adjacentTrackAfterRemoval(ordered, "deleted", (track) => track.available),
    ).toBe(ordered[0]);
    expect(adjacentTrackAfterRemoval([{ id: "deleted" }], "deleted")).toBeNull();
  });

  test("accepts only non-empty persisted ids", () => {
    expect(restoredTrackId("affirmation-id")).toBe("affirmation-id");
    expect(restoredTrackId("")).toBeNull();
    expect(restoredTrackId(undefined)).toBeNull();
  });

  test("restores a complete persisted player track", () => {
    const playingTrack = {
      source: "custom" as const,
      id: "custom-id",
      title: "I am ready",
      affirmation: "[affirmation] I am ready",
      isCustom: true,
    };

    expect(restoredPlayingTrack(playingTrack)).toEqual(playingTrack);
  });

  test("rejects incomplete or invalid persisted player tracks", () => {
    expect(restoredPlayingTrack({ source: "custom", id: "custom-id" })).toBeNull();
    expect(
      restoredPlayingTrack({
        source: "unknown",
        id: "custom-id",
        title: "Title",
        affirmation: "Affirmation",
        isCustom: true,
      }),
    ).toBeNull();
  });
});
