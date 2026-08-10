import type { Affirmation } from "./affirmations";

export type CustomFavoriteTrack = Affirmation & { offlineReady: boolean };
export type FavoriteTrack = CustomFavoriteTrack & { isCustom: boolean };

export function buildFavoriteTracks(
  includedTracks: readonly Affirmation[],
  customTracks: readonly CustomFavoriteTrack[],
  favoriteIds: ReadonlySet<string>,
): FavoriteTrack[] {
  return [
    ...includedTracks
      .filter((track) => favoriteIds.has(track.id))
      .map((track) => ({ ...track, offlineReady: true, isCustom: false })),
    ...customTracks
      .filter((track) => favoriteIds.has(track.id))
      .map((track) => ({ ...track, isCustom: true })),
  ];
}
