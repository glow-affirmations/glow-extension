import { describe, expect, test } from "bun:test";
import {
  DEFAULT_REPEAT_PAUSE_SECONDS,
  MAX_REPEAT_PAUSE_SECONDS,
  REPEAT_PAUSE_STORAGE_KEY,
  clampRepeatPauseSeconds,
  firstRepeatPauseSeconds,
  readRepeatPausePreference,
  validRepeatPauseSeconds,
  writeRepeatPausePreference,
} from "../webview/src/lib/repeatPausePreference";

describe("repeat pause preference", () => {
  test("defaults to two seconds", () => {
    expect(DEFAULT_REPEAT_PAUSE_SECONDS).toBe(2);
    expect(firstRepeatPauseSeconds(undefined, null, Number.NaN)).toBe(2);
  });

  test("accepts whole-second pauses from zero through ten", () => {
    expect(validRepeatPauseSeconds(0)).toBe(0);
    expect(validRepeatPauseSeconds(2)).toBe(2);
    expect(validRepeatPauseSeconds(MAX_REPEAT_PAUSE_SECONDS)).toBe(10);
    expect(validRepeatPauseSeconds(-1)).toBeNull();
    expect(validRepeatPauseSeconds(2.5)).toBeNull();
    expect(validRepeatPauseSeconds(11)).toBeNull();
  });

  test("clamps and rounds stepper input", () => {
    expect(clampRepeatPauseSeconds(-4)).toBe(0);
    expect(clampRepeatPauseSeconds(2.4)).toBe(2);
    expect(clampRepeatPauseSeconds(2.6)).toBe(3);
    expect(clampRepeatPauseSeconds(99)).toBe(10);
  });

  test("round-trips the selected pause through storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };

    expect(writeRepeatPausePreference(storage, 4)).toBe(true);
    expect(values.get(REPEAT_PAUSE_STORAGE_KEY)).toBe("4");
    expect(readRepeatPausePreference(storage)).toBe(4);
  });
});
