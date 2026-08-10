export function readyCreatedAffirmation<
  Track extends { id: string; offlineReady: boolean },
>(tracks: readonly Track[], pendingId: string | null): Track | null {
  if (!pendingId) return null;
  return tracks.find((track) => track.id === pendingId && track.offlineReady) ?? null;
}
