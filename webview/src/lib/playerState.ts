import type { AffirmationCategory } from "./affirmations";
import type { BinauralPreset } from "./binauralPreference";

export type LibraryTab = "included" | "favorites" | "custom";

export type LibraryTrackSelections = {
  favorites: string | null;
  custom: string | null;
};

export type PersistedPlayingTrack = {
  source: LibraryTab;
  id: string;
  title: string;
  affirmation: string;
  isCustom: boolean;
};

export type PersistedPlayerState = {
  version: 4;
  selectedLibraryTab: LibraryTab;
  selectedTrackIds: LibraryTrackSelections;
  playingTrack: PersistedPlayingTrack;
  selectedCategory: AffirmationCategory;
  playingCategory?: AffirmationCategory;
  selectedIndices: Record<AffirmationCategory, number>;
  currentTime: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  volume?: number;
  repeatPauseSeconds?: number;
  binauralVolume?: number;
  binauralPreset?: BinauralPreset;
};

export type LegacyPersistedPlayerStateV3 = {
  version: 3;
  selectedLibraryTab: LibraryTab;
  selectedTrackIds: LibraryTrackSelections;
  selectedCategory: AffirmationCategory;
  playingCategory?: AffirmationCategory;
  selectedIndices: Record<AffirmationCategory, number>;
  currentTime: number;
  isPlaying: boolean;
  loopEnabled: boolean;
  volume?: number;
};

export type LegacyPersistedPlayerStateV2 = {
  version: 2;
  selectedCategory: AffirmationCategory;
  selectedIndices: Record<AffirmationCategory, number>;
  currentTime: number;
  isPlaying: boolean;
  loopEnabled: boolean;
};

export type LegacyPersistedPlayerStateV1 = {
  version: 1;
  selectedIndex: number;
  currentTime: number;
  isPlaying: boolean;
  loopEnabled: boolean;
};

export type SolWebviewState = {
  player?:
    | PersistedPlayerState
    | LegacyPersistedPlayerStateV3
    | LegacyPersistedPlayerStateV2
    | LegacyPersistedPlayerStateV1;
};

export type PlayerStateApi = {
  getState(): SolWebviewState | undefined;
  setState(state: SolWebviewState): void;
};
