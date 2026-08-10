export const DEFAULT_REPEAT_PAUSE_SECONDS = 2;
export const MIN_REPEAT_PAUSE_SECONDS = 0;
export const MAX_REPEAT_PAUSE_SECONDS = 10;
export const REPEAT_PAUSE_STEP_SECONDS = 1;
export const REPEAT_PAUSE_STORAGE_KEY = "glow.repeatPauseSeconds";

export type RepeatPauseStorage = Pick<Storage, "getItem" | "setItem">;

export function clampRepeatPauseSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_REPEAT_PAUSE_SECONDS;
  const rounded = Math.round(value / REPEAT_PAUSE_STEP_SECONDS) * REPEAT_PAUSE_STEP_SECONDS;
  return Math.min(MAX_REPEAT_PAUSE_SECONDS, Math.max(MIN_REPEAT_PAUSE_SECONDS, rounded));
}

export function validRepeatPauseSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < MIN_REPEAT_PAUSE_SECONDS || value > MAX_REPEAT_PAUSE_SECONDS) return null;
  if (value % REPEAT_PAUSE_STEP_SECONDS !== 0) return null;
  return value;
}

export function firstRepeatPauseSeconds(...values: unknown[]): number {
  for (const value of values) {
    const pause = validRepeatPauseSeconds(value);
    if (pause !== null) return pause;
  }
  return DEFAULT_REPEAT_PAUSE_SECONDS;
}

export function readRepeatPausePreference(storage: RepeatPauseStorage): number | null {
  try {
    const rawValue = storage.getItem(REPEAT_PAUSE_STORAGE_KEY);
    if (rawValue === null) return null;
    return validRepeatPauseSeconds(Number(rawValue));
  } catch {
    return null;
  }
}

export function writeRepeatPausePreference(
  storage: RepeatPauseStorage,
  seconds: number,
): boolean {
  const pause = validRepeatPauseSeconds(seconds);
  if (pause === null) return false;
  try {
    storage.setItem(REPEAT_PAUSE_STORAGE_KEY, String(pause));
    return true;
  } catch {
    return false;
  }
}
