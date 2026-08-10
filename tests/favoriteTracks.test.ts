import { describe, expect, test } from "bun:test";
import { buildFavoriteTracks } from "../webview/src/lib/favoriteTracks";

describe("favorite tracks", () => {
  const included = {
    id: "included-id",
    title: "Included",
    affirmation: "I am included.",
    audio: "included.mp3",
  };
  const custom = {
    id: "custom-id",
    title: "Custom",
    affirmation: "I am custom.",
    audio: "",
    offlineReady: true,
  };

  test("combines included and custom favorites", () => {
    const tracks = buildFavoriteTracks(
      [included],
      [custom],
      new Set([included.id, custom.id]),
    );

    expect(tracks.map((track) => track.id)).toEqual([included.id, custom.id]);
    expect(tracks.map((track) => track.isCustom)).toEqual([false, true]);
  });

  test("keeps custom readiness for playback routing", () => {
    const tracks = buildFavoriteTracks(
      [],
      [{ ...custom, offlineReady: false }],
      new Set([custom.id]),
    );

    expect(tracks[0]).toMatchObject({ id: custom.id, isCustom: true, offlineReady: false });
  });
});
