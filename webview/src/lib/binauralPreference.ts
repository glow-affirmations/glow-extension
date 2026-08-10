export type BackgroundNoiseColor = "white" | "brown";
export type BinauralPreset = "calm" | "focus" | BackgroundNoiseColor;

export type BinauralPresetDefinition =
  | {
      kind: "binaural";
      label: string;
      beatHz: number;
      leftHz: number;
      rightHz: number;
    }
  | {
      kind: "noise";
      label: string;
      noiseColor: BackgroundNoiseColor;
    };

export const DEFAULT_BINAURAL_VOLUME = 0;
export const DEFAULT_ACTIVE_BINAURAL_VOLUME = 0.35;
export const DEFAULT_BINAURAL_PRESET: BinauralPreset = "calm";
export const BINAURAL_VOLUME_STORAGE_KEY = "glow.binauralVolume";
export const BINAURAL_PRESET_STORAGE_KEY = "glow.binauralPreset";

export const BINAURAL_PRESETS = {
  calm: {
    kind: "binaural",
    label: "Calm",
    beatHz: 6,
    leftHz: 134,
    rightHz: 140,
  },
  focus: {
    kind: "binaural",
    label: "Focus",
    beatHz: 40,
    leftHz: 134,
    rightHz: 174,
  },
  white: { kind: "noise", label: "White noise", noiseColor: "white" },
  brown: { kind: "noise", label: "Brown noise", noiseColor: "brown" },
} as const satisfies Record<BinauralPreset, BinauralPresetDefinition>;

export type BinauralStorage = Pick<Storage, "getItem" | "setItem">;

export function clampBinauralVolume(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BINAURAL_VOLUME;
  return Math.min(1, Math.max(0, value));
}

export function validBinauralVolume(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : null;
}

export function isBinauralPreset(value: unknown): value is BinauralPreset {
  return (
    value === "calm" ||
    value === "focus" ||
    value === "white" ||
    value === "brown"
  );
}

export function isPremiumBinauralPreset(preset: BinauralPreset): boolean {
  return BINAURAL_PRESETS[preset].kind === "binaural";
}

export function firstBinauralVolume(...values: unknown[]): number {
  for (const value of values) {
    const volume = validBinauralVolume(value);
    if (volume !== null) return volume;
  }
  return DEFAULT_BINAURAL_VOLUME;
}

export function firstBinauralPreset(...values: unknown[]): BinauralPreset {
  for (const value of values) {
    if (isBinauralPreset(value)) return value;
  }
  return DEFAULT_BINAURAL_PRESET;
}

export function readBinauralPreferences(storage: BinauralStorage): {
  volume: number | null;
  preset: BinauralPreset | null;
} {
  try {
    const rawVolume = storage.getItem(BINAURAL_VOLUME_STORAGE_KEY);
    const rawPreset = storage.getItem(BINAURAL_PRESET_STORAGE_KEY);
    return {
      volume:
        rawVolume === null ? null : validBinauralVolume(Number(rawVolume)),
      preset: isBinauralPreset(rawPreset) ? rawPreset : null,
    };
  } catch {
    return { volume: null, preset: null };
  }
}

export function writeBinauralPreferences(
  storage: BinauralStorage,
  volume: number,
  preset: BinauralPreset,
): boolean {
  const validVolume = validBinauralVolume(volume);
  if (validVolume === null || !isBinauralPreset(preset)) return false;
  try {
    storage.setItem(BINAURAL_VOLUME_STORAGE_KEY, String(validVolume));
    storage.setItem(BINAURAL_PRESET_STORAGE_KEY, preset);
    return true;
  } catch {
    return false;
  }
}
