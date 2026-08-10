import { describe, expect, test } from "bun:test";
import {
  clampVolume,
  DEFAULT_VOLUME,
  firstVolume,
  parseStoredVolume,
  readVolumePreference,
  validVolume,
  writeVolumePreference,
} from "../webview/src/lib/volumePreference";

describe("volume preference", () => {
  test("accepts the complete media volume range", () => {
    expect(validVolume(0)).toBe(0);
    expect(validVolume(0.42)).toBe(0.42);
    expect(validVolume(1)).toBe(1);
  });

  test("rejects malformed persisted values", () => {
    expect(validVolume(-0.1)).toBeNull();
    expect(validVolume(1.1)).toBeNull();
    expect(validVolume(Number.NaN)).toBeNull();
    expect(parseStoredVolume("")).toBeNull();
    expect(parseStoredVolume("loud")).toBeNull();
  });

  test("uses the first valid persistence source and otherwise defaults safely", () => {
    expect(firstVolume(undefined, 0.35, 1)).toBe(0.35);
    expect(firstVolume(undefined, 4)).toBe(DEFAULT_VOLUME);
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(3)).toBe(1);
    expect(DEFAULT_VOLUME).toBe(0.5);
  });

  test("round-trips a changed volume through storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readVolumePreference(storage)).toBeNull();
    expect(writeVolumePreference(storage, 0.27)).toBeTrue();
    expect(readVolumePreference(storage)).toBe(0.27);
    expect(writeVolumePreference(storage, 8)).toBeFalse();
    expect(readVolumePreference(storage)).toBe(0.27);
  });
});
