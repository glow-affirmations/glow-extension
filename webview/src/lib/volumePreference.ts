export const DEFAULT_VOLUME = 0.5;
export const VOLUME_STORAGE_KEY = "sol.volume";

export type VolumeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function validVolume(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

export function parseStoredVolume(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  return validVolume(Number(value));
}

export function firstVolume(...values: unknown[]): number {
  for (const value of values) {
    const volume = validVolume(value);
    if (volume !== null) return volume;
  }
  return DEFAULT_VOLUME;
}

export function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_VOLUME;
}

export function readVolumePreference(storage: VolumeStorage): number | null {
  try {
    return parseStoredVolume(storage.getItem(VOLUME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeVolumePreference(storage: VolumeStorage, volume: number): boolean {
  const validPreference = validVolume(volume);
  if (validPreference === null) return false;

  try {
    storage.setItem(VOLUME_STORAGE_KEY, String(validPreference));
    return true;
  } catch {
    return false;
  }
}
