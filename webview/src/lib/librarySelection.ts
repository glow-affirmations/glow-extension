import type { LibraryTab, PersistedPlayingTrack } from "./playerState";

export function selectedTrackOrFirst<T extends { id: string }>(
  tracks: readonly T[],
  selectedId: string | null,
): T | null {
  return tracks.find((track) => track.id === selectedId) ?? tracks[0] ?? null;
}

export function adjacentTrackAfterRemoval<T extends { id: string }>(
  tracks: readonly T[],
  removedId: string,
  isAvailable: (track: T) => boolean = () => true,
): T | null {
  const removedIndex = tracks.findIndex((track) => track.id === removedId);
  if (removedIndex < 0) return tracks.find(isAvailable) ?? null;

  for (let distance = 1; distance < tracks.length; distance += 1) {
    const next = tracks[removedIndex + distance];
    if (next && isAvailable(next)) return next;

    const previous = tracks[removedIndex - distance];
    if (previous && isAvailable(previous)) return previous;
  }

  return null;
}

export function restoredTrackId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function restoredPlayingTrack(value: unknown): PersistedPlayingTrack | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<PersistedPlayingTrack>;
  if (
    !isLibraryTab(candidate.source) ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0 ||
    typeof candidate.title !== "string" ||
    typeof candidate.affirmation !== "string" ||
    typeof candidate.isCustom !== "boolean"
  ) {
    return null;
  }

  return {
    source: candidate.source,
    id: candidate.id,
    title: candidate.title,
    affirmation: candidate.affirmation,
    isCustom: candidate.isCustom,
  };
}

function isLibraryTab(value: unknown): value is LibraryTab {
  return value === "included" || value === "favorites" || value === "custom";
}
